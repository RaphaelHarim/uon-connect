import type { DepartmentRole, PlatformRole, TeamRole, UserStatus } from '@uon/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../../authz/context.js';
import { grantPermissionFor } from '../../authz/permissions.js';
import { revokeUserSessions } from '../../auth/sessions.js';
import {
  conversationMembers,
  conversations,
  departmentMemberships,
  departments,
  teamMemberships,
  teams,
  userRoles,
  users,
} from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { type RequestMeta, recordAudit } from '../audit/service.js';

type UserRow = typeof users.$inferSelect;

export class PolicyDenied extends AppError {
  constructor(message: string, code = 'forbidden') {
    super(403, code, message);
  }
}

async function deny(deps: Deps, ctx: AuthContext, action: string, target: string | null, reason: string, message: string, meta?: RequestMeta, code?: string): Promise<never> {
  await recordAudit(deps.db, {
    actor: ctx,
    action,
    resourceType: 'user',
    resourceId: target ?? undefined,
    outcome: 'denied',
    metadata: { reason },
    meta,
  });
  throw new PolicyDenied(message, code);
}

export async function loadUser(deps: Deps, id: string): Promise<UserRow> {
  const [u] = await deps.db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw notFound('Usuário não encontrado.');
  return u;
}

async function rolesOf(deps: Deps, userId: string): Promise<PlatformRole[]> {
  const rows = await deps.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.role);
}

/**
 * Rules shared by every operation that changes another account:
 *  - nobody changes their own privileges, status or memberships through admin routes;
 *  - the founder account is never a valid target of administrative changes;
 *  - accounts holding any platform role can only be changed by a Supreme Admin.
 */
async function assertCanAdminister(deps: Deps, ctx: AuthContext, target: UserRow, action: string, meta?: RequestMeta) {
  if (!ctx.permissions.has('users.manage')) {
    await deny(deps, ctx, action, target.id, 'missing_permission', 'Você não tem permissão para administrar usuários.', meta);
  }
  if (target.id === ctx.userId) {
    await deny(deps, ctx, action, target.id, 'self_change', 'Alterações administrativas na própria conta precisam ser feitas por outro administrador.', meta);
  }
  if (target.isFounder) {
    await deny(deps, ctx, action, target.id, 'founder_protected', 'A conta fundadora é protegida e não pode ser alterada por operações administrativas.', meta, 'founder_protected');
  }
  const targetRoles = await rolesOf(deps, target.id);
  if (targetRoles.length > 0 && !ctx.permissions.has('users.manage_privileged')) {
    await deny(deps, ctx, action, target.id, 'privileged_target', 'Somente um Supreme Admin pode alterar contas administrativas.', meta);
  }
}

export async function changeUserStatus(
  deps: Deps,
  ctx: AuthContext,
  targetId: string,
  status: UserStatus,
  reason: string | undefined,
  meta?: RequestMeta,
) {
  const target = await loadUser(deps, targetId);
  await assertCanAdminister(deps, ctx, target, 'user.status_changed', meta);
  if (target.status === status) return { changed: false };
  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        status,
        deactivatedAt: status === 'active' ? null : new Date(),
        deactivationReason: status === 'active' ? null : reason ?? null,
      })
      .where(eq(users.id, target.id));
    if (status !== 'active') await revokeUserSessions(tx, target.id, `account_${status}`);
    await recordAudit(tx, {
      actor: ctx,
      action: 'user.status_changed',
      resourceType: 'user',
      resourceId: target.id,
      outcome: 'success',
      metadata: { from: target.status, to: status, reason: reason ?? null },
      meta,
    });
  });
  // History (tickets, messages, audit) is kept: accounts are never deleted.
  deps.realtime.toUsers([target.id], 'session:revoked', { reason: 'account_status' });
  if (status !== 'active') deps.realtime.disconnectUser(target.id);
  return { changed: true };
}

export async function bulkChangeStatus(deps: Deps, ctx: AuthContext, ids: string[], status: UserStatus, reason: string | undefined, meta?: RequestMeta) {
  const results: { userId: string; ok: boolean; code?: string; message?: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const r = await changeUserStatus(deps, ctx, id, status, reason, meta);
      results.push({ userId: id, ok: true, code: r.changed ? 'changed' : 'unchanged' });
    } catch (err) {
      const e = err as AppError;
      results.push({ userId: id, ok: false, code: e.code ?? 'error', message: e.message });
    }
  }
  return results;
}

export async function grantRole(deps: Deps, ctx: AuthContext, targetId: string, role: PlatformRole, meta?: RequestMeta) {
  const target = await loadUser(deps, targetId);
  const action = 'role.granted';
  if (!ctx.permissions.has(grantPermissionFor(role))) {
    await deny(deps, ctx, action, target.id, `cannot_grant_${role}`,
      role === 'supreme_admin' ? 'Somente a conta fundadora pode designar Supreme Admins.' : 'Você não pode conceder esta função.', meta);
  }
  if (target.id === ctx.userId) await deny(deps, ctx, action, target.id, 'self_change', 'Você não pode alterar as próprias funções.', meta);
  if (target.status !== 'active') throw badRequest('Somente contas ativas podem receber funções.');
  await deps.db.transaction(async (tx) => {
    await tx.insert(userRoles).values({ userId: target.id, role, grantedBy: ctx.userId }).onConflictDoNothing();
    await recordAudit(tx, { actor: ctx, action, resourceType: 'user', resourceId: target.id, outcome: 'success', metadata: { role }, meta });
  });
}

export async function revokeRole(deps: Deps, ctx: AuthContext, targetId: string, role: PlatformRole, meta?: RequestMeta) {
  const target = await loadUser(deps, targetId);
  const action = 'role.revoked';
  if (target.isFounder) {
    await deny(deps, ctx, action, target.id, 'founder_protected', 'A conta fundadora não pode perder suas funções.', meta, 'founder_protected');
  }
  if (target.id === ctx.userId) await deny(deps, ctx, action, target.id, 'self_change', 'Você não pode alterar as próprias funções.', meta);
  if (!ctx.permissions.has(grantPermissionFor(role))) {
    await deny(deps, ctx, action, target.id, `cannot_revoke_${role}`,
      role === 'supreme_admin' ? 'Somente a conta fundadora pode remover Supreme Admins.' : 'Você não pode remover esta função.', meta);
  }
  await deps.db.transaction(async (tx) => {
    await tx.delete(userRoles).where(and(eq(userRoles.userId, target.id), eq(userRoles.role, role)));
    await recordAudit(tx, { actor: ctx, action, resourceType: 'user', resourceId: target.id, outcome: 'success', metadata: { role }, meta });
  });
}

export async function setDepartmentMembership(deps: Deps, ctx: AuthContext, targetId: string, departmentId: string, role: DepartmentRole | null, meta?: RequestMeta) {
  const target = await loadUser(deps, targetId);
  await assertCanAdminister(deps, ctx, target, 'membership.department', meta);
  const [dept] = await deps.db.select().from(departments).where(eq(departments.id, departmentId));
  if (!dept) throw notFound('Departamento não encontrado.');
  await deps.db.transaction(async (tx) => {
    const [before] = await tx.select().from(departmentMemberships).where(and(eq(departmentMemberships.userId, target.id), eq(departmentMemberships.departmentId, departmentId)));
    if (role === null) {
      await tx.delete(departmentMemberships).where(and(eq(departmentMemberships.userId, target.id), eq(departmentMemberships.departmentId, departmentId)));
    } else {
      await tx.insert(departmentMemberships).values({ userId: target.id, departmentId, role })
        .onConflictDoUpdate({ target: [departmentMemberships.userId, departmentMemberships.departmentId], set: { role } });
    }
    await recordAudit(tx, {
      actor: ctx, action: 'membership.department', resourceType: 'user', resourceId: target.id, outcome: 'success',
      metadata: { departmentId, departmentName: dept.name, from: before?.role ?? null, to: role }, meta,
    });
  });
}

export async function setTeamMembership(deps: Deps, ctx: AuthContext, targetId: string, teamId: string, role: TeamRole | null, meta?: RequestMeta) {
  const target = await loadUser(deps, targetId);
  await assertCanAdminister(deps, ctx, target, 'membership.team', meta);
  const [team] = await deps.db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) throw notFound('Equipe não encontrada.');
  await deps.db.transaction(async (tx) => {
    const [before] = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.userId, target.id), eq(teamMemberships.teamId, teamId)));
    if (role === null) {
      await tx.delete(teamMemberships).where(and(eq(teamMemberships.userId, target.id), eq(teamMemberships.teamId, teamId)));
    } else {
      await tx.insert(teamMemberships).values({ userId: target.id, teamId, role })
        .onConflictDoUpdate({ target: [teamMemberships.userId, teamMemberships.teamId], set: { role } });
    }
    await syncTeamGroups(tx, teamId, target.id, role !== null);
    await recordAudit(tx, {
      actor: ctx, action: 'membership.team', resourceType: 'user', resourceId: target.id, outcome: 'success',
      metadata: { teamId, teamName: team.name, from: before?.role ?? null, to: role }, meta,
    });
  });
}

/** Group conversations linked to a team follow the team's membership. */
async function syncTeamGroups(tx: Parameters<Parameters<Deps['db']['transaction']>[0]>[0], teamId: string, userId: string, member: boolean) {
  const groups = await tx.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.teamId, teamId), eq(conversations.type, 'group'), isNull(conversations.archivedAt)));
  for (const g of groups) {
    if (member) {
      await tx.insert(conversationMembers).values({ conversationId: g.id, userId })
        .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { leftAt: null, joinedAt: new Date() } });
    } else {
      await tx.update(conversationMembers).set({ leftAt: new Date() })
        .where(and(eq(conversationMembers.conversationId, g.id), eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)));
    }
  }
}

export async function revokeSessionsOf(deps: Deps, ctx: AuthContext, targetId: string, meta?: RequestMeta) {
  const target = await loadUser(deps, targetId);
  if (!ctx.permissions.has('sessions.revoke')) {
    await deny(deps, ctx, 'session.revoked_by_admin', target.id, 'missing_permission', 'Você não pode revogar sessões de outros usuários.', meta);
  }
  if (target.isFounder && !ctx.user.isFounder) {
    await deny(deps, ctx, 'session.revoked_by_admin', target.id, 'founder_protected', 'Somente a própria conta fundadora pode encerrar suas sessões.', meta, 'founder_protected');
  }
  const n = await revokeUserSessions(deps.db, target.id, 'admin_revoked');
  await recordAudit(deps.db, { actor: ctx, action: 'session.revoked_by_admin', resourceType: 'user', resourceId: target.id, outcome: 'success', metadata: { count: n }, meta });
  deps.realtime.toUsers([target.id], 'session:revoked', { reason: 'admin' });
  deps.realtime.disconnectUser(target.id);
  return n;
}

export { forbidden };
