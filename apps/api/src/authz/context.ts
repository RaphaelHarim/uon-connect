import type { DepartmentRole, Permission, PlatformRole, TeamRole } from '@uon/shared';
import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import type { AuthMethod } from '../auth/sessions.js';
import { departmentMemberships, departments, teamMemberships, teams, userRoles, users } from '../db/schema/index.js';
import { forbidden } from '../lib/errors.js';
import { permissionsFor } from './permissions.js';

export interface AuthContext {
  userId: string;
  user: { id: string; displayName: string; email: string; isFounder: boolean; isDemo: boolean; status: string };
  roles: Set<PlatformRole>;
  permissions: Set<Permission>;
  departments: Map<string, DepartmentRole>;
  teams: Map<string, { role: TeamRole; departmentId: string }>;
  /** Departments the user leads. */
  headDepartmentIds: Set<string>;
  /** Departments whose service desk the user works (agents and heads). */
  agentDepartmentIds: Set<string>;
  coordinatedTeamIds: Set<string>;
  /** Teams the user supervises: coordinated teams plus every team of a department they lead. */
  overseenTeamIds: Set<string>;
  memberTeamIds: Set<string>;
  /** Departments the user belongs to, directly or through a team. */
  memberDepartmentIds: Set<string>;
  sessionId: string;
  csrfToken: string;
  authMethod: AuthMethod;
  /**
   * Local-account session without a second factor for a user holding a platform role, while
   * LOCAL_AUTH_ADMIN_MFA_REQUIRED is on: the roles stay visible but grant no permission until
   * the user turns on 2FA (or signs in again with it).
   */
  adminMfaPending: boolean;
}

export async function loadAuthContext(
  db: Tx,
  userId: string,
  session: { id: string; csrfToken: string; authMethod: AuthMethod; mfa: boolean },
  opts: { requireAdminMfa?: boolean } = {},
): Promise<AuthContext | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== 'active') return null;

  const [roleRows, deptRows, teamRows] = await Promise.all([
    db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
    db
      .select({ departmentId: departmentMemberships.departmentId, role: departmentMemberships.role })
      .from(departmentMemberships)
      .innerJoin(departments, eq(departments.id, departmentMemberships.departmentId))
      .where(eq(departmentMemberships.userId, userId)),
    db
      .select({ teamId: teamMemberships.teamId, role: teamMemberships.role, departmentId: teams.departmentId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(eq(teamMemberships.userId, userId)),
  ]);

  const roles = new Set(roleRows.map((r) => r.role));
  const deptMap = new Map(deptRows.map((d) => [d.departmentId, d.role] as const));
  const teamMap = new Map(teamRows.map((t) => [t.teamId, { role: t.role, departmentId: t.departmentId }] as const));

  const headDepartmentIds = new Set(deptRows.filter((d) => d.role === 'head').map((d) => d.departmentId));
  const agentDepartmentIds = new Set(
    deptRows.filter((d) => d.role === 'agent' || d.role === 'head').map((d) => d.departmentId),
  );
  const coordinatedTeamIds = new Set(teamRows.filter((t) => t.role === 'coordinator').map((t) => t.teamId));
  const overseenTeamIds = new Set(coordinatedTeamIds);
  if (headDepartmentIds.size > 0) {
    const all = await db.select({ id: teams.id, departmentId: teams.departmentId }).from(teams);
    for (const t of all) if (headDepartmentIds.has(t.departmentId)) overseenTeamIds.add(t.id);
  }
  const memberDepartmentIds = new Set([...deptMap.keys(), ...teamRows.map((t) => t.departmentId)]);
  const adminMfaPending = !!opts.requireAdminMfa && session.authMethod === 'local' && !session.mfa && (roles.size > 0 || user.isFounder);

  return {
    userId,
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      isFounder: user.isFounder,
      isDemo: user.isDemo,
      status: user.status,
    },
    roles,
    permissions: adminMfaPending ? new Set() : permissionsFor(roles, user.isFounder),
    departments: deptMap,
    teams: teamMap,
    headDepartmentIds,
    agentDepartmentIds,
    coordinatedTeamIds,
    overseenTeamIds,
    memberTeamIds: new Set(teamMap.keys()),
    memberDepartmentIds,
    sessionId: session.id,
    csrfToken: session.csrfToken,
    authMethod: session.authMethod,
    adminMfaPending,
  };
}

export function requirePermission(ctx: AuthContext, permission: Permission) {
  if (!ctx.permissions.has(permission)) throw forbidden();
}

export const isLeader = (ctx: AuthContext) => ctx.headDepartmentIds.size > 0 || ctx.coordinatedTeamIds.size > 0;
