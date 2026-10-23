import {
  bulkUserStatusBody,
  createUserBody,
  departmentMembershipBody,
  idParam,
  paginationQuery,
  PLATFORM_ROLES,
  roleGrantBody,
  teamMembershipBody,
  updateUserBody,
  userStatusBody,
} from '@uon/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '../../authz/context.js';
import { permissionsFor } from '../../authz/permissions.js';
import {
  auditEvents,
  companies,
  departmentMemberships,
  departments,
  sessions,
  teamMemberships,
  teams,
  userIdentities,
  userRoles,
  users,
} from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { conflict } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { toUserSummary } from '../../lib/users.js';
import { recordAudit } from '../audit/service.js';
import { orgLabels } from '../me/routes.js';
import {
  bulkChangeStatus,
  changeUserStatus,
  grantRole,
  loadUser,
  PolicyDenied,
  revokeRole,
  revokeSessionsOf,
  setDepartmentMembership,
  setTeamMembership,
} from './service.js';

export function registerUserAdminRoutes(app: App, deps: Deps) {
  const { db } = deps;
  const guard = (req: Parameters<typeof requireAuth>[0]) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'users.manage');
    return ctx;
  };

  app.get(
    '/admin/users',
    {
      schema: {
        querystring: paginationQuery.extend({
          q: z.string().trim().max(80).optional(),
          status: z.enum(['active', 'inactive', 'offboarded']).optional(),
          role: z.enum(PLATFORM_ROLES).optional(),
          departmentId: z.uuid().optional(),
        }),
      },
    },
    async (req) => {
      guard(req);
      const { page, pageSize, q, status, role, departmentId } = req.query;
      const conds = [];
      if (q) conds.push(or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`))!);
      if (status) conds.push(eq(users.status, status));
      if (role) conds.push(inArray(users.id, db.select({ id: userRoles.userId }).from(userRoles).where(eq(userRoles.role, role))));
      if (departmentId) {
        conds.push(or(
          inArray(users.id, db.select({ id: departmentMemberships.userId }).from(departmentMemberships).where(eq(departmentMemberships.departmentId, departmentId))),
          inArray(users.id, db.select({ id: teamMemberships.userId }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(eq(teams.departmentId, departmentId))),
        )!);
      }
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [count]] = await Promise.all([
        db.select().from(users).where(where).orderBy(asc(users.displayName)).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
      ]);
      const ids = rows.map((r) => r.id);
      const roleRows = ids.length ? await db.select().from(userRoles).where(inArray(userRoles.userId, ids)) : [];
      const labels = await orgLabels(deps, ids);
      return {
        items: rows.map((u) => ({
          ...toUserSummary(u),
          isFounder: u.isFounder,
          roles: roleRows.filter((r) => r.userId === u.id).map((r) => r.role),
          org: labels.get(u.id) ?? [],
          createdAt: u.createdAt,
        })),
        page,
        pageSize,
        total: count?.n ?? 0,
      };
    },
  );

  app.post('/admin/users', { schema: { body: createUserBody } }, async (req) => {
    const ctx = guard(req);
    const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${req.body.email}`);
    if (existing) throw conflict('Já existe um usuário com este e-mail.');
    const [company] = await db.select().from(companies).limit(1);
    const [u] = await db.insert(users).values({ ...req.body, companyId: company!.id }).returning();
    await recordAudit(db, { actor: ctx, action: 'user.created', resourceType: 'user', resourceId: u!.id, outcome: 'success', metadata: { email: u!.email }, meta: reqMeta(req) });
    return toUserSummary(u!);
  });

  app.get('/admin/users/:id', { schema: { params: idParam } }, async (req) => {
    guard(req);
    const u = await loadUser(deps, req.params.id);
    const [roles, identities, depts, tms, activeSessions, history] = await Promise.all([
      db.select().from(userRoles).where(eq(userRoles.userId, u.id)),
      db.select({ provider: userIdentities.provider, tenantId: userIdentities.tenantId, subject: userIdentities.subject, createdAt: userIdentities.createdAt, lastLoginAt: userIdentities.lastLoginAt })
        .from(userIdentities).where(eq(userIdentities.userId, u.id)),
      db.select({ departmentId: departments.id, name: departments.name, role: departmentMemberships.role })
        .from(departmentMemberships).innerJoin(departments, eq(departments.id, departmentMemberships.departmentId)).where(eq(departmentMemberships.userId, u.id)),
      db.select({ teamId: teams.id, name: teams.name, role: teamMemberships.role, departmentName: departments.name })
        .from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).innerJoin(departments, eq(departments.id, teams.departmentId))
        .where(eq(teamMemberships.userId, u.id)),
      db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`)),
      db.select().from(auditEvents).where(and(eq(auditEvents.resourceType, 'user'), eq(auditEvents.resourceId, u.id))).orderBy(desc(auditEvents.id)).limit(50),
    ]);
    return {
      ...toUserSummary(u),
      phone: u.phone,
      isFounder: u.isFounder,
      deactivatedAt: u.deactivatedAt,
      deactivationReason: u.deactivationReason,
      createdAt: u.createdAt,
      roles: roles.map((r) => ({ role: r.role, grantedAt: r.grantedAt, grantedBy: r.grantedBy })),
      // Subjects are partially masked: enough to support troubleshooting, not to impersonate.
      identities: identities.map((i) => ({ ...i, subject: i.subject.length > 8 ? `${i.subject.slice(0, 4)}…${i.subject.slice(-4)}` : '••••' })),
      departments: depts,
      teams: tms,
      activeSessions: activeSessions[0]?.n ?? 0,
      history: history.map((h) => ({ id: h.id, occurredAt: h.occurredAt, action: h.action, actorLabel: h.actorLabel, outcome: h.outcome, metadata: h.metadata })),
    };
  });

  app.patch('/admin/users/:id', { schema: { params: idParam, body: updateUserBody } }, async (req) => {
    const ctx = guard(req);
    const target = await loadUser(deps, req.params.id);
    if (target.isFounder && !ctx.user.isFounder) {
      await recordAudit(db, { actor: ctx, action: 'user.updated', resourceType: 'user', resourceId: target.id, outcome: 'denied', metadata: { reason: 'founder_protected' }, meta: reqMeta(req) });
      throw new PolicyDenied('O perfil da conta fundadora só pode ser alterado por ela mesma.', 'founder_protected');
    }
    await db.update(users).set(req.body).where(eq(users.id, target.id));
    await recordAudit(db, { actor: ctx, action: 'user.updated', resourceType: 'user', resourceId: target.id, outcome: 'success', metadata: { fields: Object.keys(req.body) }, meta: reqMeta(req) });
    return { ok: true };
  });

  app.post('/admin/users/:id/status', { schema: { params: idParam, body: userStatusBody } }, async (req) => {
    const ctx = requireAuth(req);
    return changeUserStatus(deps, ctx, req.params.id, req.body.status, req.body.reason, reqMeta(req));
  });

  app.post('/admin/users/bulk-status', { schema: { body: bulkUserStatusBody } }, async (req) => {
    const ctx = guard(req);
    return { results: await bulkChangeStatus(deps, ctx, req.body.userIds, req.body.status, req.body.reason, reqMeta(req)) };
  });

  app.post('/admin/users/:id/roles', { schema: { params: idParam, body: roleGrantBody } }, async (req) => {
    const ctx = requireAuth(req);
    await grantRole(deps, ctx, req.params.id, req.body.role, reqMeta(req));
    return { ok: true };
  });

  app.delete('/admin/users/:id/roles/:role', { schema: { params: idParam.extend({ role: z.enum(PLATFORM_ROLES) }) } }, async (req) => {
    const ctx = requireAuth(req);
    await revokeRole(deps, ctx, req.params.id, req.params.role, reqMeta(req));
    return { ok: true };
  });

  app.put('/admin/users/:id/departments', { schema: { params: idParam, body: departmentMembershipBody } }, async (req) => {
    const ctx = requireAuth(req);
    await setDepartmentMembership(deps, ctx, req.params.id, req.body.departmentId, req.body.role, reqMeta(req));
    return { ok: true };
  });

  app.delete('/admin/users/:id/departments/:departmentId', { schema: { params: idParam.extend({ departmentId: z.uuid() }) } }, async (req) => {
    const ctx = requireAuth(req);
    await setDepartmentMembership(deps, ctx, req.params.id, req.params.departmentId, null, reqMeta(req));
    return { ok: true };
  });

  app.put('/admin/users/:id/teams', { schema: { params: idParam, body: teamMembershipBody } }, async (req) => {
    const ctx = requireAuth(req);
    await setTeamMembership(deps, ctx, req.params.id, req.body.teamId, req.body.role, reqMeta(req));
    return { ok: true };
  });

  app.delete('/admin/users/:id/teams/:teamId', { schema: { params: idParam.extend({ teamId: z.uuid() }) } }, async (req) => {
    const ctx = requireAuth(req);
    await setTeamMembership(deps, ctx, req.params.id, req.params.teamId, null, reqMeta(req));
    return { ok: true };
  });

  app.post('/admin/users/:id/revoke-sessions', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    return { revoked: await revokeSessionsOf(deps, ctx, req.params.id, reqMeta(req)) };
  });

  /** Effective access of a user: roles, permissions, scopes and detected inconsistencies. */
  app.get('/admin/users/:id/effective-access', { schema: { params: idParam } }, async (req) => {
    guard(req);
    const u = await loadUser(deps, req.params.id);
    const roleRows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, u.id));
    const roles = roleRows.map((r) => r.role);
    const depts = await db.select({ id: departments.id, name: departments.name, active: departments.active, acceptsTickets: departments.acceptsTickets, role: departmentMemberships.role })
      .from(departmentMemberships).innerJoin(departments, eq(departments.id, departmentMemberships.departmentId)).where(eq(departmentMemberships.userId, u.id));
    const tms = await db.select({ id: teams.id, name: teams.name, active: teams.active, departmentId: teams.departmentId, role: teamMemberships.role })
      .from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(eq(teamMemberships.userId, u.id));
    const headed = depts.filter((d) => d.role === 'head');
    const overseenTeams = headed.length
      ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.departmentId, headed.map((d) => d.id)))
      : [];

    const conflicts: string[] = [];
    if (u.status !== 'active' && roles.length) conflicts.push('Conta inativa mantém funções administrativas.');
    for (const d of depts) {
      if (!d.active) conflicts.push(`Vínculo com departamento inativo: ${d.name}.`);
      if (d.role === 'agent' && !d.acceptsTickets) conflicts.push(`Atendente em ${d.name}, que não recebe chamados.`);
    }
    for (const t of tms) if (!t.active) conflicts.push(`Vínculo com equipe inativa: ${t.name}.`);
    if (roles.includes('supreme_admin') && roles.includes('platform_admin')) conflicts.push('Funções redundantes: Supreme Admin já inclui Administrador da plataforma.');

    return {
      user: toUserSummary(u),
      isFounder: u.isFounder,
      roles,
      permissions: [...permissionsFor(roles, u.isFounder)],
      contentAccessNote:
        'Funções administrativas não dão acesso a conteúdo de chamados, conversas ou arquivos; esse acesso depende dos vínculos abaixo.',
      scopes: {
        headOf: headed.map((d) => ({ id: d.id, name: d.name })),
        serviceDeskOf: depts.filter((d) => (d.role === 'agent' || d.role === 'head') && d.acceptsTickets).map((d) => ({ id: d.id, name: d.name })),
        coordinatorOf: tms.filter((t) => t.role === 'coordinator').map((t) => ({ id: t.id, name: t.name })),
        oversees: [...new Map([...tms.filter((t) => t.role === 'coordinator'), ...overseenTeams].map((t) => [t.id, { id: t.id, name: t.name }])).values()],
        memberOf: tms.map((t) => ({ id: t.id, name: t.name })),
      },
      conflicts,
    };
  });
}
