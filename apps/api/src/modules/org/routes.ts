import { clientBody, departmentBody, idParam, teamBody } from '@uon/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { requirePermission } from '../../authz/context.js';
import { clients, companies, departmentMemberships, departments, teamMemberships, teams, users } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { toUserSummary } from '../../lib/users.js';
import { recordAudit } from '../audit/service.js';

export function registerOrgRoutes(app: App, deps: Deps) {
  const { db } = deps;
  const company = async () => {
    const [c] = await db.select().from(companies).limit(1);
    if (!c) throw badRequest('Empresa não configurada. Execute o seed de configuração inicial.');
    return c;
  };

  /** Organisation structure (names only). Visible to every signed-in employee. */
  app.get('/org/structure', async (req) => {
    requireAuth(req);
    const [c, depts, tms, cls, heads, coords] = await Promise.all([
      company(),
      db.select().from(departments).orderBy(asc(departments.name)),
      db.select().from(teams).orderBy(asc(teams.name)),
      db.select().from(clients).orderBy(asc(clients.name)),
      db.select({ departmentId: departmentMemberships.departmentId, user: users })
        .from(departmentMemberships).innerJoin(users, eq(users.id, departmentMemberships.userId))
        .where(and(eq(departmentMemberships.role, 'head'), eq(users.status, 'active'))),
      db.select({ teamId: teamMemberships.teamId, user: users })
        .from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(and(eq(teamMemberships.role, 'coordinator'), eq(users.status, 'active'))),
    ]);
    const memberCounts = await db
      .select({ teamId: teamMemberships.teamId, n: sql<number>`count(*)::int` })
      .from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(eq(users.status, 'active')).groupBy(teamMemberships.teamId);
    const counts = new Map(memberCounts.map((m) => [m.teamId, m.n]));
    return {
      company: { id: c.id, name: c.name },
      clients: cls,
      departments: depts.map((d) => ({
        ...d,
        heads: heads.filter((h) => h.departmentId === d.id).map((h) => toUserSummary(h.user)),
        teams: tms
          .filter((t) => t.departmentId === d.id)
          .map((t) => ({
            ...t,
            clientName: cls.find((x) => x.id === t.clientId)?.name ?? null,
            coordinators: coords.filter((x) => x.teamId === t.id).map((x) => toUserSummary(x.user)),
            memberCount: counts.get(t.id) ?? 0,
          })),
      })),
    };
  });

  app.post('/admin/departments', { schema: { body: departmentBody } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'org.manage');
    const c = await company();
    const [row] = await db.insert(departments).values({ ...req.body, companyId: c.id }).returning();
    await recordAudit(db, { actor: ctx, action: 'org.department_created', resourceType: 'department', resourceId: row!.id, outcome: 'success', metadata: { name: row!.name }, meta: reqMeta(req) });
    return row;
  });

  app.put('/admin/departments/:id', { schema: { params: idParam, body: departmentBody } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'org.manage');
    const [before] = await db.select().from(departments).where(eq(departments.id, req.params.id));
    if (!before) throw notFound();
    const [row] = await db.update(departments).set(req.body).where(eq(departments.id, req.params.id)).returning();
    await recordAudit(db, { actor: ctx, action: 'org.department_updated', resourceType: 'department', resourceId: row!.id, outcome: 'success', metadata: { before: { name: before.name, acceptsTickets: before.acceptsTickets, active: before.active }, after: req.body }, meta: reqMeta(req) });
    return row;
  });

  app.post('/admin/teams', { schema: { body: teamBody } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'org.manage');
    const [dept] = await db.select().from(departments).where(eq(departments.id, req.body.departmentId));
    if (!dept) throw badRequest('Departamento inexistente.');
    const [row] = await db.insert(teams).values(req.body).returning();
    await recordAudit(db, { actor: ctx, action: 'org.team_created', resourceType: 'team', resourceId: row!.id, outcome: 'success', metadata: { name: row!.name, departmentId: dept.id }, meta: reqMeta(req) });
    return row;
  });

  app.put('/admin/teams/:id', { schema: { params: idParam, body: teamBody } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'org.manage');
    const [before] = await db.select().from(teams).where(eq(teams.id, req.params.id));
    if (!before) throw notFound();
    const [row] = await db.update(teams).set(req.body).where(eq(teams.id, req.params.id)).returning();
    await recordAudit(db, { actor: ctx, action: 'org.team_updated', resourceType: 'team', resourceId: row!.id, outcome: 'success', metadata: { before: { name: before.name, departmentId: before.departmentId, clientId: before.clientId, active: before.active }, after: req.body }, meta: reqMeta(req) });
    return row;
  });

  app.post('/admin/clients', { schema: { body: clientBody } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'org.manage');
    const c = await company();
    const [row] = await db.insert(clients).values({ ...req.body, companyId: c.id }).returning();
    await recordAudit(db, { actor: ctx, action: 'org.client_created', resourceType: 'client', resourceId: row!.id, outcome: 'success', metadata: { name: row!.name }, meta: reqMeta(req) });
    return row;
  });

  app.put('/admin/clients/:id', { schema: { params: idParam, body: clientBody } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'org.manage');
    const [row] = await db.update(clients).set(req.body).where(eq(clients.id, req.params.id)).returning();
    if (!row) throw notFound();
    await recordAudit(db, { actor: ctx, action: 'org.client_updated', resourceType: 'client', resourceId: row.id, outcome: 'success', metadata: req.body, meta: reqMeta(req) });
    return row;
  });
}
