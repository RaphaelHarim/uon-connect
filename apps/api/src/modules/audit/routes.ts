import { auditListQuery } from '@uon/shared';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { requirePermission } from '../../authz/context.js';
import { auditEvents } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { dayEnd, dayStart } from '../../lib/time.js';
import { reqMeta, requireAuth, sendCsv } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from './service.js';

export async function verifyAuditChain(deps: Deps) {
  const res = await deps.db.execute(sql`
    WITH ordered AS (
      SELECT e.id, e.hash, e.prev_hash, lag(e.hash) OVER (ORDER BY e.id) AS expected_prev, uon_audit_hash(e, e.prev_hash) AS recomputed
      FROM audit_events e
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE hash IS DISTINCT FROM recomputed OR prev_hash IS DISTINCT FROM expected_prev)::int AS broken,
           min(id) FILTER (WHERE hash IS DISTINCT FROM recomputed OR prev_hash IS DISTINCT FROM expected_prev) AS first_broken_id
    FROM ordered`);
  const r = res.rows[0] as { total: number; broken: number; first_broken_id: string | null };
  return { total: r.total, broken: r.broken, firstBrokenId: r.first_broken_id ? Number(r.first_broken_id) : null, ok: r.broken === 0 };
}

export function registerAuditRoutes(app: App, deps: Deps) {
  const { db } = deps;
  const conditions = (q: typeof auditListQuery._output) =>
    and(
      q.action ? eq(auditEvents.action, q.action) : undefined,
      q.actorId ? eq(auditEvents.actorUserId, q.actorId) : undefined,
      q.resourceType ? eq(auditEvents.resourceType, q.resourceType) : undefined,
      q.resourceId ? eq(auditEvents.resourceId, q.resourceId) : undefined,
      q.outcome ? eq(auditEvents.outcome, q.outcome) : undefined,
      q.from ? gte(auditEvents.occurredAt, dayStart(q.from)!) : undefined,
      q.to ? lt(auditEvents.occurredAt, dayEnd(q.to)!) : undefined,
    );

  app.get('/admin/audit', { schema: { querystring: auditListQuery } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'audit.read');
    const q = req.query;
    const where = conditions(q);
    const [rows, [count]] = await Promise.all([
      db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`count(*)::int` }).from(auditEvents).where(where),
    ]);
    return { items: rows, page: q.page, pageSize: q.pageSize, total: count?.n ?? 0 };
  });

  app.get('/admin/audit/export', { schema: { querystring: auditListQuery } }, async (req, reply) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'audit.read');
    const rows = await db.select().from(auditEvents).where(conditions(req.query)).orderBy(desc(auditEvents.id)).limit(10_000);
    await recordAudit(db, { actor: ctx, action: 'audit.exported', outcome: 'success', metadata: { count: rows.length }, meta: reqMeta(req) });
    return sendCsv(reply, `auditoria-${new Date().toISOString().slice(0, 10)}.csv`,
      ['ID', 'Data', 'Autor', 'Ação', 'Recurso', 'ID do recurso', 'Resultado', 'Correlação', 'IP', 'Detalhes', 'Hash'],
      rows.map((r) => [r.id, r.occurredAt.toISOString(), r.actorLabel, r.action, r.resourceType, r.resourceId, r.outcome, r.correlationId, r.ip, r.metadata ? JSON.stringify(r.metadata) : '', r.hash]));
  });

  app.get('/admin/audit/verify', async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'audit.read');
    const result = await verifyAuditChain(deps);
    await recordAudit(db, { actor: ctx, action: 'audit.verified', outcome: result.ok ? 'success' : 'failure', metadata: result, meta: reqMeta(req) });
    return result;
  });
}
