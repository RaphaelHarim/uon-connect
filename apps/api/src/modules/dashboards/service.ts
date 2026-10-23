import { OPEN_TICKET_STATUSES } from '@uon/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../../deps.js';
import { dayEnd, dayStart } from '../../lib/time.js';

export interface Range {
  from: Date;
  to: Date;
}

export function resolveRange(from?: string, to?: string): Range {
  const end = to ? dayEnd(to)! : dayEnd(new Date().toISOString().slice(0, 10))!;
  const start = from ? dayStart(from)! : new Date(end.getTime() - 30 * 86_400_000);
  return { from: start, to: end };
}

const OPEN = sql.raw(OPEN_TICKET_STATUSES.map((s) => `'${s}'`).join(','));

/** Definitions shown next to each indicator so numbers are never ambiguous. */
export const METRIC_DEFINITIONS = {
  created: 'Chamados abertos no período (cada chamado é contado uma vez, pela data de abertura).',
  byStatus: 'Situação atual dos chamados abertos no período.',
  backlog: 'Chamados ainda não resolvidos (abertos, em triagem, em andamento ou aguardando), independentemente da data de abertura.',
  resolved: 'Chamados marcados como resolvidos dentro do período.',
  resolutionHours: 'Tempo corrido (horas de calendário, não horas úteis) entre a abertura e a resolução dos chamados resolvidos no período.',
  sla: 'Somente chamados com política de SLA configurada. Chamados sem política aparecem como "SLA não configurado".',
  workload: 'Chamados não resolvidos atribuídos a cada pessoa no momento. Volume não mede produtividade: considere complexidade e contexto.',
  weekly: 'Chamados abertos por semana (segunda a domingo) no período.',
  monthly: 'Chamados abertos por mês nos últimos 12 meses.',
};

/** All ticket indicators for a scope expressed as a SQL predicate over `t` (tickets). */
export async function ticketMetrics(deps: Deps, scope: SQL, range: Range, extra: SQL = sql`true`) {
  const { db } = deps;
  const base = sql`FROM tickets t WHERE (${scope}) AND (${extra})`;
  const inRange = sql`t.created_at >= ${range.from} AND t.created_at < ${range.to}`;

  const [summary, byStatus, weekly, workload, byClient, byTeam, resolution] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${inRange})::int AS created,
        count(*) FILTER (WHERE t.status_key IN (${OPEN}))::int AS backlog,
        count(*) FILTER (WHERE t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to})::int AS resolved,
        count(*) FILTER (WHERE t.status_key IN (${OPEN}) AND t.assignee_id IS NULL)::int AS unassigned,
        count(*) FILTER (WHERE t.status_key IN (${OPEN}) AND t.sla_policy_id IS NOT NULL AND t.resolution_due_at < now())::int AS overdue,
        count(*) FILTER (WHERE t.status_key IN (${OPEN}) AND t.sla_policy_id IS NULL)::int AS without_sla,
        count(*) FILTER (WHERE t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to} AND t.sla_policy_id IS NOT NULL)::int AS resolved_with_sla,
        count(*) FILTER (WHERE t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to} AND t.sla_policy_id IS NOT NULL AND t.resolved_at <= t.resolution_due_at)::int AS resolved_within_sla
      ${base}`),
    db.execute(sql`
      SELECT t.status_key AS key, s.label, s.color, count(*)::int AS n
      FROM tickets t JOIN ticket_statuses s ON s.key = t.status_key
      WHERE (${scope}) AND (${extra}) AND ${inRange}
      GROUP BY t.status_key, s.label, s.color, s.sort_order ORDER BY s.sort_order`),
    db.execute(sql`
      SELECT to_char(date_trunc('week', t.created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS week, count(*)::int AS n
      ${base} AND ${inRange}
      GROUP BY 1 ORDER BY 1`),
    db.execute(sql`
      SELECT t.assignee_id AS user_id, coalesce(u.display_name, 'Sem responsável') AS name,
             count(*) FILTER (WHERE t.status_key IN (${OPEN}))::int AS open,
             count(*) FILTER (WHERE t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to})::int AS resolved
      FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE (${scope}) AND (${extra}) AND (t.status_key IN (${OPEN}) OR (t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to}))
      GROUP BY t.assignee_id, u.display_name ORDER BY open DESC, name LIMIT 30`),
    db.execute(sql`
      SELECT c.id, coalesce(c.name, 'Sem carteira') AS name,
             count(*) FILTER (WHERE ${inRange})::int AS created,
             count(*) FILTER (WHERE t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to})::int AS resolved,
             count(*) FILTER (WHERE t.status_key IN (${OPEN}))::int AS backlog,
             round(avg(extract(epoch FROM (t.resolved_at - t.created_at)) / 3600) FILTER (WHERE t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to})::numeric, 1)::float AS avg_resolution_hours
      FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
      WHERE (${scope}) AND (${extra})
      GROUP BY c.id, c.name ORDER BY created DESC`),
    db.execute(sql`
      SELECT tm.id, coalesce(tm.name, 'Sem equipe') AS name,
             count(*) FILTER (WHERE ${inRange})::int AS created,
             count(*) FILTER (WHERE t.status_key IN (${OPEN}))::int AS backlog,
             count(*) FILTER (WHERE t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to})::int AS resolved
      FROM tickets t LEFT JOIN teams tm ON tm.id = coalesce(t.handling_team_id, t.requester_team_id)
      WHERE (${scope}) AND (${extra})
      GROUP BY tm.id, tm.name ORDER BY created DESC`),
    db.execute(sql`
      SELECT round(avg(h)::numeric, 1)::float AS avg, round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h))::numeric, 1)::float AS median, count(*)::int AS n
      FROM (SELECT extract(epoch FROM (t.resolved_at - t.created_at)) / 3600 AS h ${base}
            AND t.resolved_at >= ${range.from} AND t.resolved_at < ${range.to}) x`),
  ]);

  const s = summary.rows[0] as Record<string, number>;
  const r = resolution.rows[0] as { avg: number | null; median: number | null; n: number };
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    summary: {
      created: s.created,
      backlog: s.backlog,
      resolved: s.resolved,
      unassigned: s.unassigned,
      sla: {
        overdue: s.overdue,
        withoutSla: s.without_sla,
        resolvedWithSla: s.resolved_with_sla,
        resolvedWithinSla: s.resolved_within_sla,
        complianceRate: s.resolved_with_sla ? Math.round((s.resolved_within_sla! / s.resolved_with_sla) * 1000) / 10 : null,
      },
      resolutionHours: { average: r.avg, median: r.median, sample: r.n },
    },
    byStatus: byStatus.rows as { key: string; label: string; color: string; n: number }[],
    weekly: weekly.rows as { week: string; n: number }[],
    workload: workload.rows as { user_id: string | null; name: string; open: number; resolved: number }[],
    byClient: byClient.rows as { id: string | null; name: string; created: number; resolved: number; backlog: number; avg_resolution_hours: number | null }[],
    byTeam: byTeam.rows as { id: string | null; name: string; created: number; backlog: number; resolved: number }[],
    definitions: METRIC_DEFINITIONS,
  };
}

/** Tickets opened per month (last 12 months) for each client portfolio within a scope. */
export async function monthlyByClient(deps: Deps, scope: SQL) {
  const res = await deps.db.execute(sql`
    SELECT to_char(date_trunc('month', t.created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS month,
           coalesce(c.name, 'Sem carteira') AS client, count(*)::int AS n
    FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
    WHERE (${scope}) AND t.created_at >= date_trunc('month', now()) - interval '11 months'
    GROUP BY 1, 2 ORDER BY 1, 2`);
  return res.rows as { month: string; client: string; n: number }[];
}

export const uuidList = (ids: Iterable<string>) => {
  const arr = [...ids];
  return arr.length ? sql.join(arr.map((i) => sql`${i}::uuid`), sql`, `) : sql`NULL::uuid`;
};
