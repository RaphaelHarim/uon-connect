import { OPEN_TICKET_STATUSES, type TicketDestination, type TicketStatusKey } from '@uon/shared';
import type { z } from 'zod';
import type { createTicketBody, ticketListQuery } from '@uon/shared';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthContext } from '../../authz/context.js';
import type { Tx } from '../../db/client.js';
import {
  businessCalendars,
  businessHolidays,
  clients,
  departmentMemberships,
  departments,
  files,
  slaPolicies,
  teamMemberships,
  teams,
  ticketAttachments,
  ticketCategories,
  ticketComments,
  ticketEvents,
  ticketPriorities,
  ticketStatuses,
  ticketStatusTransitions,
  ticketWatchers,
  tickets,
  users,
} from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { dayEnd, dayStart } from '../../lib/time.js';
import { toUserSummary } from '../../lib/users.js';
import { type RequestMeta, recordAudit } from '../audit/service.js';
import { fileView } from '../files/service.js';
import { notify } from '../notifications/service.js';
import { getSetting } from '../settings/service.js';
import { handlesQueue, queueClause, type TicketRelation, ticketRelation, visibilityClause } from './policy.js';
import { addBusinessMinutes, slaState } from './sla.js';

export type TicketRow = typeof tickets.$inferSelect;

/* ------------------------------------------------------------------ destinations */

export interface DestinationOption {
  destination: TicketDestination;
  targetId: string;
  label: string;
  departmentId: string;
}

/** Destinations the user may send a ticket to. Computed on the server and re-checked on create. */
export async function allowedDestinations(deps: Deps, ctx: AuthContext): Promise<DestinationOption[]> {
  const { db } = deps;
  const out: DestinationOption[] = [];
  if (ctx.memberTeamIds.size) {
    const rows = await db
      .select({ id: teams.id, name: teams.name, departmentId: teams.departmentId, departmentName: departments.name })
      .from(teams)
      .innerJoin(departments, eq(departments.id, teams.departmentId))
      .where(and(inArray(teams.id, [...ctx.memberTeamIds]), eq(teams.active, true)));
    for (const t of rows) out.push({ destination: 'team', targetId: t.id, label: `Coordenação — ${t.name} (${t.departmentName})`, departmentId: t.departmentId });
  }
  if (ctx.memberDepartmentIds.size) {
    const rows = await db.select().from(departments).where(and(inArray(departments.id, [...ctx.memberDepartmentIds]), eq(departments.active, true)));
    for (const d of rows) out.push({ destination: 'department_head', targetId: d.id, label: `Responsável — ${d.name}`, departmentId: d.id });
  }
  const desks = await db.select().from(departments).where(and(eq(departments.acceptsTickets, true), eq(departments.active, true))).orderBy(asc(departments.name));
  for (const d of desks) out.push({ destination: 'service_desk', targetId: d.id, label: `Atendimento — ${d.name}`, departmentId: d.id });
  return out;
}

/* ------------------------------------------------------------------ SLA */

async function computeSla(db: Tx, start: Date, priorityKey: string, categoryId: string) {
  const policies = await db
    .select()
    .from(slaPolicies)
    .where(and(eq(slaPolicies.active, true), eq(slaPolicies.priorityKey, priorityKey), or(eq(slaPolicies.categoryId, categoryId), isNull(slaPolicies.categoryId))));
  // A category-specific policy wins over the generic one.
  const policy = policies.find((p) => p.categoryId === categoryId) ?? policies.find((p) => p.categoryId === null);
  if (!policy) return { slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null };
  const [cal] = await db.select().from(businessCalendars).where(eq(businessCalendars.id, policy.calendarId));
  const hol = await db.select({ date: businessHolidays.date }).from(businessHolidays).where(eq(businessHolidays.calendarId, policy.calendarId));
  const spec = { timezone: cal!.timezone, workingHours: cal!.workingHours, holidays: new Set(hol.map((h) => h.date)) };
  const firstResponseDueAt = addBusinessMinutes(start, policy.firstResponseMinutes, spec);
  const resolutionDueAt = addBusinessMinutes(start, policy.resolutionMinutes, spec);
  if (!resolutionDueAt) return { slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null };
  return { slaPolicyId: policy.id, firstResponseDueAt, resolutionDueAt };
}

/* ------------------------------------------------------------------ helpers */

async function addEvent(db: Tx, ticketId: string, actorId: string | null, type: string, from?: string | null, to?: string | null, data?: Record<string, unknown>) {
  await db.insert(ticketEvents).values({ ticketId, actorId, type, fromValue: from ?? null, toValue: to ?? null, data: data ?? null });
}

async function watcherIds(db: Tx, ticketId: string) {
  const rows = await db.select({ userId: ticketWatchers.userId }).from(ticketWatchers).where(eq(ticketWatchers.ticketId, ticketId));
  return rows.map((r) => r.userId);
}

export async function loadTicketFor(deps: Deps, ctx: AuthContext, id: string): Promise<{ ticket: TicketRow; rel: TicketRelation; watchers: string[] }> {
  const [ticket] = await deps.db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  // Same answer whether the ticket doesn't exist or isn't visible: no information leak.
  if (!ticket) throw notFound('Chamado não encontrado.');
  const watchers = await watcherIds(deps.db, id);
  const rel = ticketRelation(ctx, ticket, watchers);
  if (!rel.canView) throw notFound('Chamado não encontrado.');
  return { ticket, rel, watchers };
}

/** People who should hear about changes: requester, assignee and watchers. */
function stakeholders(t: TicketRow, watchers: string[]) {
  return [t.requesterId, ...(t.assigneeId ? [t.assigneeId] : []), ...watchers];
}

/** Users working the queue the ticket is in (used to announce new tickets). */
async function queueMembers(db: Tx, t: Pick<TicketRow, 'destination' | 'handlingDepartmentId' | 'handlingTeamId'>) {
  if (t.destination === 'team' && t.handlingTeamId) {
    const coords = await db.select({ id: teamMemberships.userId }).from(teamMemberships).where(and(eq(teamMemberships.teamId, t.handlingTeamId), eq(teamMemberships.role, 'coordinator')));
    if (coords.length) return coords.map((c) => c.id);
  }
  const roles: ('head' | 'agent')[] = t.destination === 'service_desk' ? ['head', 'agent'] : ['head'];
  const rows = await db
    .select({ id: departmentMemberships.userId })
    .from(departmentMemberships)
    .where(and(eq(departmentMemberships.departmentId, t.handlingDepartmentId), inArray(departmentMemberships.role, roles)));
  return rows.map((r) => r.id);
}

const ticketLink = (t: { id: string }) => `/chamados/${t.id}`;

/* ------------------------------------------------------------------ create */

export async function createTicket(deps: Deps, ctx: AuthContext, input: z.infer<typeof createTicketBody>, meta?: RequestMeta) {
  const { db } = deps;
  const [category] = await db.select().from(ticketCategories).where(and(eq(ticketCategories.id, input.categoryId), eq(ticketCategories.active, true)));
  if (!category) throw badRequest('Categoria inválida.');
  const [priority] = await db.select().from(ticketPriorities).where(and(eq(ticketPriorities.key, input.priority), eq(ticketPriorities.active, true)));
  if (!priority) throw badRequest('Prioridade inválida.');

  let destination = input.destination;
  let targetId = input.targetId;
  // Categories bound to a service desk (e.g. technical support → TI) always route there.
  if (category.serviceDepartmentId) {
    destination = 'service_desk';
    targetId = category.serviceDepartmentId;
  }
  const options = await allowedDestinations(deps, ctx);
  const chosen = options.find((o) => o.destination === destination && o.targetId === targetId);
  if (!chosen) throw forbidden('Destino de chamado não autorizado para você.');

  const handlingTeamId = destination === 'team' ? targetId : null;
  const handlingDepartmentId = chosen.departmentId;

  // Requester context: the team/department the request comes from.
  let requesterTeamId: string | null = null;
  let requesterDepartmentId: string | null = null;
  if (destination === 'team') {
    requesterTeamId = targetId;
    requesterDepartmentId = handlingDepartmentId;
  } else {
    const myTeams = [...ctx.teams.entries()];
    const sameDept = myTeams.find(([, t]) => t.departmentId === handlingDepartmentId);
    const first = sameDept ?? myTeams[0];
    requesterTeamId = first?.[0] ?? null;
    requesterDepartmentId = first?.[1].departmentId ?? [...ctx.departments.keys()][0] ?? null;
  }

  let clientId: string | null = null;
  if (requesterTeamId) {
    const [t] = await db.select({ clientId: teams.clientId }).from(teams).where(eq(teams.id, requesterTeamId));
    clientId = t?.clientId ?? null;
  }
  if (input.clientId) {
    const [c] = await db.select().from(clients).where(and(eq(clients.id, input.clientId), eq(clients.active, true)));
    if (!c) throw badRequest('Cliente inválido.');
    clientId = c.id;
  }

  const now = new Date();
  const ticket = await db.transaction(async (tx) => {
    const seq = await tx.execute(sql`SELECT nextval(pg_get_serial_sequence('tickets', 'number'))::bigint AS n`);
    const number = Number((seq.rows[0] as { n: string }).n);
    const protocol = `UON-${now.getUTCFullYear()}-${String(number).padStart(6, '0')}`;
    const sla = await computeSla(tx, now, priority.key, category.id);
    const [row] = await tx
      .insert(tickets)
      .values({
        number,
        protocol,
        title: input.title,
        description: input.description,
        requesterId: ctx.userId,
        requesterDepartmentId,
        requesterTeamId,
        clientId,
        categoryId: category.id,
        priorityKey: priority.key,
        statusKey: 'open',
        destination,
        handlingDepartmentId,
        handlingTeamId,
        confidential: input.confidential || category.defaultConfidential,
        ...sla,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await addEvent(tx, row!.id, ctx.userId, 'created', null, 'open', { destination, priority: priority.key });
    await recordAudit(tx, { actor: ctx, action: 'ticket.created', resourceType: 'ticket', resourceId: row!.id, outcome: 'success', metadata: { protocol, destination }, meta });
    return row!;
  });

  await notify(deps, {
    userIds: await queueMembers(db, ticket),
    excludeUserId: ctx.userId,
    category: 'ticket_created',
    title: `Novo chamado ${ticket.protocol} na sua fila`,
    body: ticket.confidential ? 'Chamado confidencial.' : ticket.title,
    link: ticketLink(ticket),
    resourceType: 'ticket',
    resourceId: ticket.id,
  });
  deps.realtime.toUsers(await queueMembers(db, ticket), 'ticket:updated', { id: ticket.id });
  return ticket;
}

/* ------------------------------------------------------------------ list */

type ListQuery = z.infer<typeof ticketListQuery>;

const requester = alias(users, 'requester');
const assignee = alias(users, 'assignee');

export function listConditions(ctx: AuthContext, q: Partial<ListQuery>): SQL {
  const conds: (SQL | undefined)[] = [visibilityClause(ctx)];
  switch (q.view) {
    case 'requested':
      conds.push(eq(tickets.requesterId, ctx.userId));
      break;
    case 'assigned':
      conds.push(eq(tickets.assigneeId, ctx.userId));
      break;
    case 'queue':
      conds.push(queueClause(ctx));
      break;
    case 'watching':
      conds.push(sql`EXISTS (SELECT 1 FROM ${ticketWatchers} WHERE ${ticketWatchers.ticketId} = ${tickets.id} AND ${ticketWatchers.userId} = ${ctx.userId})`);
      break;
    default:
      break;
  }
  if (q.status?.length) conds.push(inArray(tickets.statusKey, q.status));
  if (q.priority?.length) conds.push(inArray(tickets.priorityKey, q.priority));
  if (q.categoryId) conds.push(eq(tickets.categoryId, q.categoryId));
  if (q.assigneeId === 'none') conds.push(isNull(tickets.assigneeId));
  else if (q.assigneeId === 'me') conds.push(eq(tickets.assigneeId, ctx.userId));
  else if (q.assigneeId) conds.push(eq(tickets.assigneeId, q.assigneeId));
  if (q.teamId) conds.push(or(eq(tickets.handlingTeamId, q.teamId), eq(tickets.requesterTeamId, q.teamId)));
  if (q.departmentId) conds.push(or(eq(tickets.handlingDepartmentId, q.departmentId), eq(tickets.requesterDepartmentId, q.departmentId)));
  if (q.clientId) conds.push(eq(tickets.clientId, q.clientId));
  if (q.from) conds.push(gte(tickets.createdAt, dayStart(q.from)!));
  if (q.to) conds.push(lt(tickets.createdAt, dayEnd(q.to)!));
  if (q.q) {
    const term = q.q.replace(/[%_\\]/g, (m) => `\\${m}`);
    conds.push(or(ilike(tickets.protocol, `%${term}%`), ilike(tickets.title, `%${term}%`)));
  }
  return and(...conds)!;
}

export async function listTickets(deps: Deps, ctx: AuthContext, q: ListQuery, opts: { limit?: number; offset?: number } = {}) {
  const { db } = deps;
  const where = listConditions(ctx, q);
  const order: SQL[] = {
    created_desc: [desc(tickets.createdAt)],
    created_asc: [asc(tickets.createdAt)],
    updated_desc: [desc(tickets.updatedAt)],
    priority_desc: [desc(ticketPriorities.rank), desc(tickets.updatedAt)],
  }[q.sort];
  const limit = opts.limit ?? q.pageSize;
  const offset = opts.offset ?? (q.page - 1) * q.pageSize;
  const [rows, [count]] = await Promise.all([
    db
      .select({
        t: tickets,
        requesterName: requester.displayName,
        assigneeName: assignee.displayName,
        categoryName: ticketCategories.name,
        priorityLabel: ticketPriorities.label,
        priorityColor: ticketPriorities.color,
        statusLabel: ticketStatuses.label,
        statusColor: ticketStatuses.color,
        departmentName: departments.name,
        teamName: teams.name,
        clientName: clients.name,
      })
      .from(tickets)
      .innerJoin(requester, eq(requester.id, tickets.requesterId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .innerJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
      .innerJoin(ticketPriorities, eq(ticketPriorities.key, tickets.priorityKey))
      .innerJoin(ticketStatuses, eq(ticketStatuses.key, tickets.statusKey))
      .innerJoin(departments, eq(departments.id, tickets.handlingDepartmentId))
      .leftJoin(teams, eq(teams.id, tickets.handlingTeamId))
      .leftJoin(clients, eq(clients.id, tickets.clientId))
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(where),
  ]);
  return {
    total: count?.n ?? 0,
    items: rows.map((r) => ({
      id: r.t.id,
      protocol: r.t.protocol,
      title: r.t.title,
      status: { key: r.t.statusKey, label: r.statusLabel, color: r.statusColor },
      priority: { key: r.t.priorityKey, label: r.priorityLabel, color: r.priorityColor },
      category: r.categoryName,
      destination: r.t.destination,
      handlingDepartment: r.departmentName,
      handlingTeam: r.teamName,
      client: r.clientName,
      requester: { id: r.t.requesterId, name: r.requesterName },
      assignee: r.t.assigneeId ? { id: r.t.assigneeId, name: r.assigneeName } : null,
      confidential: r.t.confidential,
      sla: slaState(r.t),
      resolutionDueAt: r.t.resolutionDueAt,
      createdAt: r.t.createdAt,
      updatedAt: r.t.updatedAt,
    })),
  };
}

/* ------------------------------------------------------------------ detail */

export async function ticketDetail(deps: Deps, ctx: AuthContext, id: string) {
  const { db } = deps;
  const { ticket: t, rel, watchers } = await loadTicketFor(deps, ctx, id);
  const showInternal = rel.canManage;

  const userIds = new Set([t.requesterId, ...(t.assigneeId ? [t.assigneeId] : []), ...watchers]);
  const [comments, events, attachments, category, priority, status, dept, team, client] = await Promise.all([
    db.select().from(ticketComments).where(and(eq(ticketComments.ticketId, id), showInternal ? undefined : eq(ticketComments.internal, false))).orderBy(asc(ticketComments.createdAt)),
    db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, id)).orderBy(asc(ticketEvents.createdAt)),
    db.select({ file: files, commentId: ticketAttachments.commentId, internal: ticketComments.internal })
      .from(ticketAttachments)
      .innerJoin(files, eq(files.id, ticketAttachments.fileId))
      .leftJoin(ticketComments, eq(ticketComments.id, ticketAttachments.commentId))
      .where(and(eq(ticketAttachments.ticketId, id), isNull(files.deletedAt))),
    db.select().from(ticketCategories).where(eq(ticketCategories.id, t.categoryId)).then((r) => r[0]),
    db.select().from(ticketPriorities).where(eq(ticketPriorities.key, t.priorityKey)).then((r) => r[0]),
    db.select().from(ticketStatuses).where(eq(ticketStatuses.key, t.statusKey)).then((r) => r[0]),
    db.select().from(departments).where(eq(departments.id, t.handlingDepartmentId)).then((r) => r[0]),
    t.handlingTeamId ? db.select().from(teams).where(eq(teams.id, t.handlingTeamId)).then((r) => r[0]) : Promise.resolve(undefined),
    t.clientId ? db.select().from(clients).where(eq(clients.id, t.clientId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  for (const c of comments) userIds.add(c.authorId);
  for (const e of events) if (e.actorId) userIds.add(e.actorId);
  const people = userIds.size ? await db.select().from(users).where(inArray(users.id, [...userIds])) : [];
  const byId = new Map(people.map((p) => [p.id, toUserSummary(p)]));

  const visibleAttachments = attachments.filter((a) => showInternal || !a.internal);
  const transitions = await availableTransitions(deps, ctx, t, rel);

  return {
    id: t.id,
    protocol: t.protocol,
    title: t.title,
    description: t.description,
    status: status,
    priority: priority,
    category: category ? { id: category.id, name: category.name } : null,
    destination: t.destination,
    handlingDepartment: dept ? { id: dept.id, name: dept.name } : null,
    handlingTeam: team ? { id: team.id, name: team.name } : null,
    client: client ? { id: client.id, name: client.name } : null,
    requester: byId.get(t.requesterId),
    assignee: t.assigneeId ? byId.get(t.assigneeId) ?? null : null,
    watchers: watchers.map((w) => byId.get(w)).filter(Boolean),
    confidential: t.confidential,
    sla: {
      state: slaState(t),
      firstResponseDueAt: t.firstResponseDueAt,
      resolutionDueAt: t.resolutionDueAt,
      firstRespondedAt: t.firstRespondedAt,
    },
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    cancelledAt: t.cancelledAt,
    reopenedCount: t.reopenedCount,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      internal: c.internal,
      createdAt: c.createdAt,
      author: byId.get(c.authorId),
      attachments: visibleAttachments.filter((a) => a.commentId === c.id).map((a) => fileView(a.file)),
    })),
    attachments: visibleAttachments.filter((a) => !a.commentId).map((a) => fileView(a.file)),
    events: events
      .filter((e) => showInternal || e.type !== 'internal_note')
      .map((e) => ({ id: e.id, type: e.type, from: e.fromValue, to: e.toValue, data: e.data, createdAt: e.createdAt, actor: e.actorId ? byId.get(e.actorId) ?? null : null })),
    permissions: {
      relation: { requester: rel.requester, handler: rel.handler, overseer: rel.overseer, watcher: rel.watcher },
      canComment: rel.canView && !['closed', 'cancelled'].includes(t.statusKey),
      canAddInternalNote: rel.canManage,
      canAssign: rel.canManage && handlesQueue(ctx, t),
      canChangePriority: rel.canManage,
      canManageWatchers: rel.canManage || (rel.requester && !t.confidential),
      transitions,
    },
  };
}

/* ------------------------------------------------------------------ transitions */

async function actorKinds(rel: TicketRelation) {
  const kinds: ('requester' | 'handler')[] = [];
  if (rel.requester) kinds.push('requester');
  if (rel.handler) kinds.push('handler');
  return kinds;
}

export async function availableTransitions(deps: Deps, ctx: AuthContext, t: TicketRow, rel: TicketRelation) {
  const kinds = await actorKinds(rel);
  if (!kinds.length) return [];
  const rows = await deps.db
    .select({ to: ticketStatusTransitions.toStatus, requiresReason: ticketStatusTransitions.requiresReason, label: ticketStatuses.label, actor: ticketStatusTransitions.actor })
    .from(ticketStatusTransitions)
    .innerJoin(ticketStatuses, eq(ticketStatuses.key, ticketStatusTransitions.toStatus))
    .where(and(eq(ticketStatusTransitions.fromStatus, t.statusKey), inArray(ticketStatusTransitions.actor, kinds)));
  const windowDays = await getSetting(deps.db, 'ticketReopenWindowDays');
  const out = new Map<string, { to: string; label: string; requiresReason: boolean }>();
  for (const r of rows) {
    if (t.statusKey === 'closed' && r.actor === 'requester' && !rel.handler && !withinWindow(t.closedAt, windowDays)) continue;
    const prev = out.get(r.to);
    out.set(r.to, { to: r.to, label: r.label, requiresReason: prev ? prev.requiresReason && r.requiresReason : r.requiresReason });
  }
  return [...out.values()];
}

const withinWindow = (closedAt: Date | null, days: number) => !!closedAt && Date.now() - closedAt.getTime() <= days * 86_400_000;

const STATUS_TITLES: Partial<Record<TicketStatusKey, string>> = {
  resolved: 'foi marcado como resolvido',
  closed: 'foi encerrado',
  cancelled: 'foi cancelado',
  waiting_requester: 'aguarda sua resposta',
};

export async function changeStatus(deps: Deps, ctx: AuthContext, id: string, to: TicketStatusKey, reason: string | undefined, meta?: RequestMeta) {
  const { ticket: t, rel, watchers } = await loadTicketFor(deps, ctx, id);
  if (t.statusKey === to) throw conflict('O chamado já está neste status.');
  const options = await availableTransitions(deps, ctx, t, rel);
  const opt = options.find((o) => o.to === to);
  if (!opt) {
    await recordAudit(deps.db, { actor: ctx, action: 'ticket.status_changed', resourceType: 'ticket', resourceId: t.id, outcome: 'denied', metadata: { from: t.statusKey, to }, meta });
    throw forbidden('Esta mudança de status não é permitida para você neste momento.');
  }
  if (opt.requiresReason && !reason?.trim()) throw badRequest('Informe o motivo para esta mudança de status.');

  const now = new Date();
  const reopening = (t.statusKey === 'resolved' || t.statusKey === 'closed') && !['closed', 'cancelled', 'resolved'].includes(to);
  const patch: Partial<TicketRow> = { statusKey: to, updatedAt: now };
  if (to === 'resolved') patch.resolvedAt = now;
  if (to === 'closed') patch.closedAt = now;
  if (to === 'cancelled') patch.cancelledAt = now;
  if (reopening) {
    patch.resolvedAt = null;
    patch.closedAt = null;
    patch.reopenedCount = t.reopenedCount + 1;
  }
  if (rel.handler && !rel.requester && !t.firstRespondedAt) patch.firstRespondedAt = now;

  await deps.db.transaction(async (tx) => {
    await tx.update(tickets).set(patch).where(eq(tickets.id, t.id));
    await addEvent(tx, t.id, ctx.userId, reopening ? 'reopened' : 'status_changed', t.statusKey, to, reason ? { reason } : undefined);
    if (reason) await tx.insert(ticketComments).values({ ticketId: t.id, authorId: ctx.userId, body: `${reopening ? 'Motivo da reabertura' : 'Motivo'}: ${reason}`, internal: false });
    await recordAudit(tx, { actor: ctx, action: reopening ? 'ticket.reopened' : 'ticket.status_changed', resourceType: 'ticket', resourceId: t.id, outcome: 'success', metadata: { from: t.statusKey, to }, meta });
  });

  await notify(deps, {
    userIds: stakeholders(t, watchers),
    excludeUserId: ctx.userId,
    category: 'ticket_status',
    title: `Chamado ${t.protocol} ${reopening ? 'foi reaberto' : STATUS_TITLES[to] ?? 'mudou de status'}`,
    link: ticketLink(t),
    resourceType: 'ticket',
    resourceId: t.id,
  });
  deps.realtime.toUsers(stakeholders(t, watchers), 'ticket:updated', { id: t.id });
}

/* ------------------------------------------------------------------ comments */

export async function addComment(deps: Deps, ctx: AuthContext, id: string, input: { body: string; internal: boolean; attachmentIds: string[] }, meta?: RequestMeta) {
  const { db } = deps;
  const { ticket: t, rel, watchers } = await loadTicketFor(deps, ctx, id);
  if (['closed', 'cancelled'].includes(t.statusKey)) throw conflict('Chamados encerrados ou cancelados não recebem comentários. Reabra o chamado se necessário.');
  if (input.internal && !rel.canManage) throw forbidden('Somente a equipe de atendimento pode registrar notas internas.');

  if (input.attachmentIds.length) {
    const own = await db
      .select({ fileId: ticketAttachments.fileId })
      .from(ticketAttachments)
      .innerJoin(files, eq(files.id, ticketAttachments.fileId))
      .where(and(eq(ticketAttachments.ticketId, t.id), inArray(ticketAttachments.fileId, input.attachmentIds), eq(files.uploadedBy, ctx.userId), isNull(ticketAttachments.commentId)));
    if (own.length !== new Set(input.attachmentIds).size) throw badRequest('Anexo inválido para este comentário.');
  }

  const now = new Date();
  const comment = await db.transaction(async (tx) => {
    const [c] = await tx.insert(ticketComments).values({ ticketId: t.id, authorId: ctx.userId, body: input.body, internal: input.internal }).returning();
    if (input.attachmentIds.length) {
      await tx.update(ticketAttachments).set({ commentId: c!.id }).where(inArray(ticketAttachments.fileId, input.attachmentIds));
    }
    const patch: Partial<TicketRow> = { updatedAt: now };
    if (!input.internal && rel.handler && !rel.requester && !t.firstRespondedAt) patch.firstRespondedAt = now;
    // The requester answering a "waiting for you" ticket puts it back in progress.
    if (!input.internal && rel.requester && t.statusKey === 'waiting_requester') {
      patch.statusKey = 'in_progress';
      await addEvent(tx, t.id, null, 'status_changed', 'waiting_requester', 'in_progress', { automatic: true });
    }
    await tx.update(tickets).set(patch).where(eq(tickets.id, t.id));
    await addEvent(tx, t.id, ctx.userId, input.internal ? 'internal_note' : 'comment');
    await recordAudit(tx, { actor: ctx, action: input.internal ? 'ticket.internal_note' : 'ticket.commented', resourceType: 'ticket', resourceId: t.id, outcome: 'success', meta });
    return c!;
  });

  const audience = input.internal
    ? [...(t.assigneeId ? [t.assigneeId] : []), ...(await queueMembers(db, t))]
    : stakeholders(t, watchers);
  await notify(deps, {
    userIds: audience,
    excludeUserId: ctx.userId,
    category: 'ticket_comment',
    title: `${input.internal ? 'Nota interna' : 'Nova resposta'} no chamado ${t.protocol}`,
    body: t.confidential || input.internal ? null : input.body.slice(0, 140),
    link: ticketLink(t),
    resourceType: 'ticket',
    resourceId: t.id,
    dedupeKey: `ticket-comment:${t.id}`,
  });
  deps.realtime.toUsers(audience, 'ticket:updated', { id: t.id });
  return comment;
}

/* ------------------------------------------------------------------ assignment / priority / watchers */

export async function assignableUsers(deps: Deps, t: Pick<TicketRow, 'destination' | 'handlingDepartmentId' | 'handlingTeamId'>) {
  const { db } = deps;
  const ids = new Set<string>();
  const heads = await db.select({ id: departmentMemberships.userId }).from(departmentMemberships)
    .where(and(eq(departmentMemberships.departmentId, t.handlingDepartmentId), eq(departmentMemberships.role, 'head')));
  heads.forEach((h) => ids.add(h.id));
  if (t.destination === 'team' && t.handlingTeamId) {
    const m = await db.select({ id: teamMemberships.userId }).from(teamMemberships).where(eq(teamMemberships.teamId, t.handlingTeamId));
    m.forEach((x) => ids.add(x.id));
  } else if (t.destination === 'service_desk') {
    const m = await db.select({ id: departmentMemberships.userId }).from(departmentMemberships)
      .where(and(eq(departmentMemberships.departmentId, t.handlingDepartmentId), eq(departmentMemberships.role, 'agent')));
    m.forEach((x) => ids.add(x.id));
  } else {
    const m = await db.select({ id: departmentMemberships.userId }).from(departmentMemberships).where(eq(departmentMemberships.departmentId, t.handlingDepartmentId));
    m.forEach((x) => ids.add(x.id));
  }
  if (!ids.size) return [];
  const rows = await db.select().from(users).where(and(inArray(users.id, [...ids]), eq(users.status, 'active'))).orderBy(asc(users.displayName));
  return rows.map(toUserSummary);
}

export async function assignTicket(deps: Deps, ctx: AuthContext, id: string, assigneeId: string | null, meta?: RequestMeta) {
  const { ticket: t, watchers } = await loadTicketFor(deps, ctx, id);
  if (!handlesQueue(ctx, t)) {
    await recordAudit(deps.db, { actor: ctx, action: 'ticket.assigned', resourceType: 'ticket', resourceId: t.id, outcome: 'denied', meta });
    throw forbidden('Somente quem coordena a fila deste chamado pode atribuí-lo.');
  }
  if (assigneeId) {
    const eligible = await assignableUsers(deps, t);
    if (!eligible.some((u) => u.id === assigneeId)) throw badRequest('Este colaborador não pode receber chamados desta fila.');
  }
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    const patch: Partial<TicketRow> = { assigneeId, updatedAt: now };
    if (assigneeId && t.statusKey === 'open') {
      patch.statusKey = 'triage';
      await addEvent(tx, t.id, null, 'status_changed', 'open', 'triage', { automatic: true });
    }
    if (!t.firstRespondedAt && assigneeId) patch.firstRespondedAt = now;
    await tx.update(tickets).set(patch).where(eq(tickets.id, t.id));
    await addEvent(tx, t.id, ctx.userId, 'assigned', t.assigneeId, assigneeId);
    await recordAudit(tx, { actor: ctx, action: 'ticket.assigned', resourceType: 'ticket', resourceId: t.id, outcome: 'success', metadata: { from: t.assigneeId, to: assigneeId }, meta });
  });
  if (assigneeId) {
    await notify(deps, {
      userIds: [assigneeId],
      excludeUserId: ctx.userId,
      category: 'ticket_assigned',
      title: `Chamado ${t.protocol} foi atribuído a você`,
      link: ticketLink(t),
      resourceType: 'ticket',
      resourceId: t.id,
    });
  }
  deps.realtime.toUsers([...stakeholders(t, watchers), ...(assigneeId ? [assigneeId] : [])], 'ticket:updated', { id: t.id });
}

export async function changePriority(deps: Deps, ctx: AuthContext, id: string, priorityKey: string, meta?: RequestMeta) {
  const { ticket: t, rel } = await loadTicketFor(deps, ctx, id);
  if (!rel.canManage) throw forbidden('Somente a equipe de atendimento pode alterar a prioridade.');
  const [p] = await deps.db.select().from(ticketPriorities).where(and(eq(ticketPriorities.key, priorityKey), eq(ticketPriorities.active, true)));
  if (!p) throw badRequest('Prioridade inválida.');
  const sla = await computeSla(deps.db, t.createdAt, p.key, t.categoryId);
  await deps.db.transaction(async (tx) => {
    await tx.update(tickets).set({ priorityKey: p.key, ...sla, updatedAt: new Date() }).where(eq(tickets.id, t.id));
    await addEvent(tx, t.id, ctx.userId, 'priority_changed', t.priorityKey, p.key);
    await recordAudit(tx, { actor: ctx, action: 'ticket.priority_changed', resourceType: 'ticket', resourceId: t.id, outcome: 'success', metadata: { from: t.priorityKey, to: p.key }, meta });
  });
}

export async function addWatcher(deps: Deps, ctx: AuthContext, id: string, userId: string, meta?: RequestMeta) {
  const { ticket: t, rel } = await loadTicketFor(deps, ctx, id);
  if (!(rel.canManage || (rel.requester && !t.confidential))) throw forbidden('Você não pode compartilhar este chamado.');
  const [u] = await deps.db.select().from(users).where(eq(users.id, userId));
  if (!u || u.status !== 'active') throw badRequest('Colaborador inválido.');
  await deps.db.insert(ticketWatchers).values({ ticketId: t.id, userId, addedBy: ctx.userId }).onConflictDoNothing();
  await addEvent(deps.db, t.id, ctx.userId, 'watcher_added', null, userId);
  await recordAudit(deps.db, { actor: ctx, action: 'ticket.shared', resourceType: 'ticket', resourceId: t.id, outcome: 'success', metadata: { userId }, meta });
  await notify(deps, { userIds: [userId], excludeUserId: ctx.userId, category: 'ticket_status', title: `O chamado ${t.protocol} foi compartilhado com você`, link: ticketLink(t), resourceType: 'ticket', resourceId: t.id });
}

export async function removeWatcher(deps: Deps, ctx: AuthContext, id: string, userId: string, meta?: RequestMeta) {
  const { ticket: t, rel } = await loadTicketFor(deps, ctx, id);
  if (!(userId === ctx.userId || rel.canManage || rel.requester)) throw forbidden();
  await deps.db.delete(ticketWatchers).where(and(eq(ticketWatchers.ticketId, t.id), eq(ticketWatchers.userId, userId)));
  await addEvent(deps.db, t.id, ctx.userId, 'watcher_removed', userId, null);
  await recordAudit(deps.db, { actor: ctx, action: 'ticket.unshared', resourceType: 'ticket', resourceId: t.id, outcome: 'success', metadata: { userId }, meta });
}

/** Statuses considered "open work"; re-exported for dashboards. */
export { OPEN_TICKET_STATUSES };
