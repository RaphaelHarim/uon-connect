import { dashboardQuery, OPEN_TICKET_STATUSES } from '@uon/shared';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../authz/context.js';
import { requirePermission } from '../../authz/context.js';
import { departments, meetingParticipants, meetings, teams, ticketEvents, tickets, users } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { forbidden } from '../../lib/errors.js';
import { reqMeta, requireAuth, sendCsv } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';
import { unreadCount } from '../notifications/service.js';
import { visibilityClause } from '../tickets/policy.js';
import { METRIC_DEFINITIONS, monthlyByClient, resolveRange, ticketMetrics, uuidList } from './service.js';

type Query = z.infer<typeof dashboardQuery>;

/** Scope predicate (over alias `t`) for the team dashboard. Mirrors ticket visibility for supervisors. */
function teamScope(teamIds: string[]) {
  const list = uuidList(teamIds);
  return sql`(t.handling_team_id IN (${list}) OR (t.requester_team_id IN (${list}) AND NOT t.confidential))`;
}

function departmentScope(departmentId: string) {
  return sql`(t.handling_department_id = ${departmentId}::uuid OR (t.requester_department_id = ${departmentId}::uuid AND NOT t.confidential))`;
}

function filters(q: Query) {
  const parts = [sql`true`];
  if (q.clientId) parts.push(sql`t.client_id = ${q.clientId}::uuid`);
  if (q.assigneeId) parts.push(sql`t.assignee_id = ${q.assigneeId}::uuid`);
  if (q.teamId) parts.push(sql`(t.handling_team_id = ${q.teamId}::uuid OR t.requester_team_id = ${q.teamId}::uuid)`);
  return sql.join(parts, sql` AND `);
}

function pickTeams(ctx: AuthContext, teamId?: string) {
  if (teamId) {
    if (!ctx.overseenTeamIds.has(teamId)) throw forbidden('Você não coordena esta equipe.');
    return [teamId];
  }
  if (!ctx.overseenTeamIds.size) throw forbidden('Você não coordena nenhuma equipe.');
  return [...ctx.overseenTeamIds];
}

function pickDepartment(ctx: AuthContext, departmentId?: string) {
  const id = departmentId ?? [...ctx.headDepartmentIds][0];
  if (!id || !ctx.headDepartmentIds.has(id)) throw forbidden('Você não é responsável por este departamento.');
  return id;
}

export function registerDashboardRoutes(app: App, deps: Deps) {
  const { db } = deps;

  app.get('/dashboards/scopes', async (req) => {
    const ctx = requireAuth(req);
    const tms = ctx.overseenTeamIds.size
      ? await db.select({ id: teams.id, name: teams.name, departmentId: teams.departmentId, clientId: teams.clientId }).from(teams).where(inArray(teams.id, [...ctx.overseenTeamIds])).orderBy(asc(teams.name))
      : [];
    const depts = ctx.headDepartmentIds.size
      ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...ctx.headDepartmentIds])).orderBy(asc(departments.name))
      : [];
    return { teams: tms, departments: depts, admin: ctx.permissions.has('admin.dashboard') };
  });

  app.get('/dashboards/personal', async (req) => {
    const ctx = requireAuth(req);
    const me = ctx.userId;
    const open = sql.raw(OPEN_TICKET_STATUSES.map((s) => `'${s}'`).join(','));
    const counts = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE requester_id = ${me} AND status_key IN (${open}))::int AS requested_open,
        count(*) FILTER (WHERE requester_id = ${me} AND status_key = 'in_progress')::int AS requested_in_progress,
        count(*) FILTER (WHERE requester_id = ${me} AND status_key = 'waiting_requester')::int AS waiting_me,
        count(*) FILTER (WHERE requester_id = ${me} AND status_key = 'resolved')::int AS requested_resolved_pending_close,
        count(*) FILTER (WHERE requester_id = ${me} AND resolved_at >= now() - interval '30 days')::int AS requested_resolved_30d,
        count(*) FILTER (WHERE assignee_id = ${me} AND status_key IN (${open}))::int AS assigned_open,
        count(*) FILTER (WHERE assignee_id = ${me} AND resolved_at >= now() - interval '30 days')::int AS assigned_resolved_30d
      FROM tickets`);
    const queueOpen = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(and(visibilityClause(ctx), inArray(tickets.statusKey, OPEN_TICKET_STATUSES), isNull(tickets.assigneeId)));
    const activity = await db
      .select({ id: ticketEvents.id, type: ticketEvents.type, from: ticketEvents.fromValue, to: ticketEvents.toValue, createdAt: ticketEvents.createdAt, ticketId: tickets.id, protocol: tickets.protocol, title: tickets.title, confidential: tickets.confidential, actorName: users.displayName })
      .from(ticketEvents)
      .innerJoin(tickets, eq(tickets.id, ticketEvents.ticketId))
      .leftJoin(users, eq(users.id, ticketEvents.actorId))
      .where(and(visibilityClause(ctx), sql`${ticketEvents.type} <> 'internal_note'`))
      .orderBy(desc(ticketEvents.createdAt))
      .limit(10);
    const upcoming = await db
      .select({ id: meetings.id, title: meetings.title, start: meetings.scheduledStartAt, status: meetings.status, provider: meetings.provider })
      .from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
      .where(and(eq(meetingParticipants.userId, me), inArray(meetings.status, ['scheduled', 'live']), gte(meetings.scheduledStartAt, new Date(Date.now() - 2 * 3_600_000))))
      .orderBy(asc(meetings.scheduledStartAt))
      .limit(5);
    return {
      counts: counts.rows[0],
      unassignedInMyQueues: queueOpen[0]?.n ?? 0,
      unreadNotifications: await unreadCount(deps, me),
      recentActivity: activity.map((a) => ({ ...a, title: a.confidential ? 'Chamado confidencial' : a.title })),
      upcomingMeetings: upcoming,
      definitions: {
        requested_open: 'Chamados abertos por você que ainda não foram resolvidos.',
        waiting_me: 'Chamados seus aguardando uma resposta sua.',
        assigned_open: 'Chamados atribuídos a você ainda não resolvidos.',
        unassignedInMyQueues: 'Chamados sem responsável nas filas que você atende ou supervisiona.',
      },
    };
  });

  app.get('/dashboards/team', { schema: { querystring: dashboardQuery } }, async (req) => {
    const ctx = requireAuth(req);
    const teamIds = pickTeams(ctx, req.query.teamId);
    const range = resolveRange(req.query.from, req.query.to);
    const metrics = await ticketMetrics(deps, teamScope(teamIds), range, filters({ ...req.query, teamId: undefined }));
    const members = await db.execute(sql`SELECT count(DISTINCT tm.user_id)::int AS n FROM team_memberships tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id IN (${uuidList(teamIds)}) AND u.status = 'active'`);
    return { ...metrics, teamIds, activeMembers: (members.rows[0] as { n: number }).n };
  });

  app.get('/dashboards/department', { schema: { querystring: dashboardQuery } }, async (req) => {
    const ctx = requireAuth(req);
    const deptId = pickDepartment(ctx, req.query.departmentId);
    const range = resolveRange(req.query.from, req.query.to);
    const scope = departmentScope(deptId);
    const [metrics, monthly] = await Promise.all([ticketMetrics(deps, scope, range, filters(req.query)), monthlyByClient(deps, scope)]);
    const [dept] = await db.select().from(departments).where(eq(departments.id, deptId));
    return { ...metrics, department: { id: dept!.id, name: dept!.name }, monthlyByClient: monthly };
  });

  app.get('/dashboards/department/export', { schema: { querystring: dashboardQuery } }, async (req, reply) => {
    const ctx = requireAuth(req);
    const deptId = pickDepartment(ctx, req.query.departmentId);
    const range = resolveRange(req.query.from, req.query.to);
    const m = await ticketMetrics(deps, departmentScope(deptId), range, filters(req.query));
    await recordAudit(db, { actor: ctx, action: 'dashboard.exported', resourceType: 'department', resourceId: deptId, outcome: 'success', meta: reqMeta(req) });
    return sendCsv(reply, `indicadores-${range.from.toISOString().slice(0, 10)}.csv`,
      ['Carteira/cliente', 'Abertos no período', 'Resolvidos no período', 'Pendentes (backlog)', 'Tempo médio de resolução (h)'],
      m.byClient.map((c) => [c.name, c.created, c.resolved, c.backlog, c.avg_resolution_hours]));
  });

  app.get('/dashboards/admin', async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'admin.dashboard');
    // Aggregates only — no ticket titles or content.
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users WHERE status = 'active') AS users_active,
        (SELECT count(*)::int FROM users WHERE status <> 'active') AS users_inactive,
        (SELECT count(*)::int FROM users WHERE is_demo) AS users_demo,
        (SELECT count(*)::int FROM departments WHERE active) AS departments,
        (SELECT count(*)::int FROM teams WHERE active) AS teams,
        (SELECT count(*)::int FROM clients WHERE active) AS clients,
        (SELECT count(*)::int FROM tickets) AS tickets_total,
        (SELECT count(*)::int FROM tickets WHERE created_at >= now() - interval '30 days') AS tickets_30d,
        (SELECT count(*)::int FROM tickets WHERE status_key IN ('open','triage','in_progress','waiting_requester','waiting_third_party')) AS tickets_backlog,
        (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS active_sessions,
        (SELECT count(*)::int FROM user_roles WHERE role = 'supreme_admin') AS supreme_admins,
        (SELECT EXISTS (SELECT 1 FROM users WHERE is_founder)) AS founder_configured,
        (SELECT count(*)::int FROM jobs WHERE status = 'pending') AS jobs_pending,
        (SELECT count(*)::int FROM jobs WHERE status = 'failed') AS jobs_failed,
        (SELECT count(*)::int FROM sla_policies WHERE active) AS sla_policies`);
    const ticketsByStatus = await db.execute(sql`SELECT s.label, s.color, count(t.id)::int AS n FROM ticket_statuses s LEFT JOIN tickets t ON t.status_key = s.key GROUP BY s.key, s.label, s.color, s.sort_order ORDER BY s.sort_order`);
    const security = ctx.permissions.has('security.read')
      ? await db.execute(sql`
          SELECT action, outcome, count(*)::int AS n FROM audit_events
          WHERE occurred_at >= now() - interval '7 days' AND (outcome <> 'success' OR action LIKE 'auth.%' OR action LIKE 'role.%')
          GROUP BY action, outcome ORDER BY n DESC LIMIT 20`)
      : null;
    const failedJobs = await db.execute(sql`SELECT id, type, attempts, last_error, finished_at FROM jobs WHERE status = 'failed' ORDER BY id DESC LIMIT 10`);
    const integrationErrors = await db.execute(sql`SELECT integration_key, message, occurred_at FROM integration_events WHERE outcome = 'failure' ORDER BY id DESC LIMIT 10`);
    return {
      totals: res.rows[0],
      ticketsByStatus: ticketsByStatus.rows,
      securityEvents: security?.rows ?? null,
      failedJobs: failedJobs.rows,
      integrationErrors: integrationErrors.rows,
      definitions: { ...METRIC_DEFINITIONS, admin: 'Somente contagens agregadas. O painel administrativo não exibe conteúdo de chamados ou conversas.' },
    };
  });
}
