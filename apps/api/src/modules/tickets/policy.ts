import { and, eq, exists, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { AuthContext } from '../../authz/context.js';
import { ticketWatchers, tickets } from '../../db/schema/index.js';

export interface TicketLike {
  id: string;
  requesterId: string;
  requesterDepartmentId: string | null;
  requesterTeamId: string | null;
  destination: 'team' | 'department_head' | 'service_desk';
  handlingDepartmentId: string;
  handlingTeamId: string | null;
  assigneeId: string | null;
  confidential: boolean;
}

export interface TicketRelation {
  requester: boolean;
  assignee: boolean;
  watcher: boolean;
  /** Works the queue the ticket is in (or is its assignee). */
  handler: boolean;
  /** Supervises the requester's team/department (never for confidential tickets). */
  overseer: boolean;
  canView: boolean;
  /** Can see internal notes and act on the ticket (triage, assign, change status). */
  canManage: boolean;
}

/** Is `ctx` part of the queue that handles the ticket? */
export function handlesQueue(ctx: AuthContext, t: Pick<TicketLike, 'destination' | 'handlingDepartmentId' | 'handlingTeamId'>) {
  switch (t.destination) {
    case 'team':
      return !!t.handlingTeamId && ctx.overseenTeamIds.has(t.handlingTeamId);
    case 'department_head':
      return ctx.headDepartmentIds.has(t.handlingDepartmentId);
    case 'service_desk':
      return ctx.agentDepartmentIds.has(t.handlingDepartmentId);
  }
}

/**
 * Resource-level authorisation for tickets. Platform roles play no part here: being an
 * administrator does not grant access to ticket content.
 */
export function ticketRelation(ctx: AuthContext, t: TicketLike, watcherIds: Iterable<string>): TicketRelation {
  const requester = t.requesterId === ctx.userId;
  const assignee = t.assigneeId === ctx.userId;
  const watcher = new Set(watcherIds).has(ctx.userId);
  const handler = assignee || handlesQueue(ctx, t);
  const overseer =
    !t.confidential &&
    ((!!t.requesterTeamId && ctx.overseenTeamIds.has(t.requesterTeamId)) ||
      (!!t.requesterDepartmentId && ctx.headDepartmentIds.has(t.requesterDepartmentId)));
  return {
    requester,
    assignee,
    watcher,
    handler,
    overseer,
    canView: requester || watcher || handler || overseer,
    canManage: handler,
  };
}

const inSet = (col: Parameters<typeof inArray>[0], ids: Set<string>): SQL | undefined =>
  ids.size > 0 ? inArray(col, [...ids]) : undefined;

/** SQL clause for tickets in the queues `ctx` works (mirror of `handlesQueue`). */
export function queueClause(ctx: AuthContext): SQL {
  const parts = [
    ctx.overseenTeamIds.size ? and(eq(tickets.destination, 'team'), inSet(tickets.handlingTeamId, ctx.overseenTeamIds)) : undefined,
    ctx.headDepartmentIds.size ? and(eq(tickets.destination, 'department_head'), inSet(tickets.handlingDepartmentId, ctx.headDepartmentIds)) : undefined,
    ctx.agentDepartmentIds.size ? and(eq(tickets.destination, 'service_desk'), inSet(tickets.handlingDepartmentId, ctx.agentDepartmentIds)) : undefined,
  ].filter((p): p is SQL => !!p);
  return parts.length ? or(...parts)! : sql`false`;
}

/** SQL clause equivalent to `ticketRelation(...).canView`, used for lists, counts and exports. */
export function visibilityClause(ctx: AuthContext): SQL {
  const oversight = [inSet(tickets.requesterTeamId, ctx.overseenTeamIds), inSet(tickets.requesterDepartmentId, ctx.headDepartmentIds)].filter(
    (p): p is SQL => !!p,
  );
  return or(
    eq(tickets.requesterId, ctx.userId),
    eq(tickets.assigneeId, ctx.userId),
    exists(
      sql`(SELECT 1 FROM ${ticketWatchers} WHERE ${ticketWatchers.ticketId} = ${tickets.id} AND ${ticketWatchers.userId} = ${ctx.userId})`,
    ),
    queueClause(ctx),
    oversight.length ? and(eq(tickets.confidential, false), or(...oversight)) : undefined,
  )!;
}
