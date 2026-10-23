import {
  DEFAULT_NOTIFICATION_PREFS,
  type MeResponse,
  type PublicConfig,
  idParam,
  paginationQuery,
  preferencesBody,
  updateProfileBody,
} from '@uon/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { revokeSession } from '../../auth/sessions.js';
import {
  clients,
  departmentMemberships,
  departments,
  files,
  sessions,
  teamMemberships,
  teams,
  userPreferences,
  users,
} from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { notFound } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { toUserSummary } from '../../lib/users.js';
import type { Extras } from '../../routes.js';
import { recordAudit } from '../audit/service.js';
import { saveUpload, streamFile } from '../files/service.js';
import { presenceForUsers } from '../presence/service.js';

export function registerMeRoutes(app: App, deps: Deps, extras: Extras) {
  const { db, env } = deps;

  app.get('/config', async (): Promise<PublicConfig & { demoData: boolean }> => {
    const [demo] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.isDemo, true));
    return {
      appName: 'UON CONNECT',
      environment: env.NODE_ENV,
      demoMode: env.devLoginEnabled,
      demoData: (demo?.n ?? 0) > 0,
      auth: { devLoginEnabled: env.devLoginEnabled, entraEnabled: extras.entra.enabled },
      uploads: { maxFileSizeBytes: env.UPLOAD_MAX_FILE_MB * 1024 * 1024, allowedMimeTypes: env.allowedMimeTypes },
      calls: { maxParticipants: env.CALL_MAX_PARTICIPANTS, turnConfigured: env.TURN_URLS.length > 0 },
      integrations: { teamsMeetings: env.GRAPH_TEAMS_MEETINGS_ENABLED, outlookCalendar: env.GRAPH_CALENDAR_ENABLED },
      brand: { logoUrl: env.BRAND_LOGO_URL ?? null },
    };
  });

  app.get('/me', async (req): Promise<MeResponse> => {
    const ctx = requireAuth(req);
    const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
    const deptRows = await db
      .select({ id: departments.id, name: departments.name, role: departmentMemberships.role, acceptsTickets: departments.acceptsTickets })
      .from(departmentMemberships)
      .innerJoin(departments, eq(departments.id, departmentMemberships.departmentId))
      .where(eq(departmentMemberships.userId, ctx.userId))
      .orderBy(asc(departments.name));
    const teamRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        role: teamMemberships.role,
        departmentId: teams.departmentId,
        departmentName: departments.name,
        clientId: teams.clientId,
        clientName: clients.name,
      })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .innerJoin(departments, eq(departments.id, teams.departmentId))
      .leftJoin(clients, eq(clients.id, teams.clientId))
      .where(eq(teamMemberships.userId, ctx.userId))
      .orderBy(asc(teams.name));
    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, ctx.userId));
    return {
      user: { ...toUserSummary(u!), phone: u!.phone, isFounder: u!.isFounder },
      roles: [...ctx.roles],
      permissions: [...ctx.permissions],
      departments: deptRows,
      teams: teamRows,
      scopes: {
        headDepartmentIds: [...ctx.headDepartmentIds],
        agentDepartmentIds: [...ctx.agentDepartmentIds],
        coordinatedTeamIds: [...ctx.coordinatedTeamIds],
        overseenTeamIds: [...ctx.overseenTeamIds],
      },
      preferences: {
        theme: prefs?.theme ?? 'system',
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, ...(prefs?.notifications ?? {}) },
      },
      csrfToken: ctx.csrfToken,
      authMethod: ctx.authMethod,
    };
  });

  app.patch('/me', { schema: { body: updateProfileBody } }, async (req) => {
    const ctx = requireAuth(req);
    await db.update(users).set(req.body).where(eq(users.id, ctx.userId));
    await recordAudit(db, { actor: ctx, action: 'profile.updated', resourceType: 'user', resourceId: ctx.userId, outcome: 'success', metadata: { fields: Object.keys(req.body) }, meta: reqMeta(req) });
    return { ok: true };
  });

  app.put('/me/preferences', { schema: { body: preferencesBody } }, async (req) => {
    const ctx = requireAuth(req);
    const [current] = await db.select().from(userPreferences).where(eq(userPreferences.userId, ctx.userId));
    const next = {
      theme: req.body.theme ?? current?.theme ?? 'system',
      notifications: { ...(current?.notifications ?? {}), ...(req.body.notifications ?? {}) },
    };
    await db.insert(userPreferences).values({ userId: ctx.userId, ...next }).onConflictDoUpdate({ target: userPreferences.userId, set: next });
    return next;
  });

  app.get('/me/sessions', async (req) => {
    const ctx = requireAuth(req);
    const rows = await db
      .select({
        id: sessions.id,
        authMethod: sessions.authMethod,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        revokedReason: sessions.revokedReason,
      })
      .from(sessions)
      .where(eq(sessions.userId, ctx.userId))
      .orderBy(desc(sessions.createdAt))
      .limit(30);
    // Session ids are hashes; expose only a short reference plus "current" marker.
    return rows.map((r) => ({ ...r, id: r.id.slice(0, 16), current: r.id === ctx.sessionId }));
  });

  app.delete('/me/sessions/:ref', { schema: { params: z.object({ ref: z.string().regex(/^[a-f0-9]{16}$/) }) } }, async (req) => {
    const ctx = requireAuth(req);
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, ctx.userId), sql`left(${sessions.id}, 16) = ${req.params.ref}`, isNull(sessions.revokedAt)))
      .limit(1);
    if (!row) throw notFound('Sessão não encontrada.');
    await revokeSession(db, row.id, 'user_revoked');
    await recordAudit(db, { actor: ctx, action: 'session.revoked', resourceType: 'user', resourceId: ctx.userId, outcome: 'success', meta: reqMeta(req) });
    return { ok: true };
  });

  app.post('/me/avatar', async (req) => {
    const ctx = requireAuth(req);
    const file = await saveUpload(deps, req, { purpose: 'avatar', contextId: ctx.userId, uploaderId: ctx.userId, imagesOnly: true });
    await db.update(users).set({ avatarFileId: file.id }).where(eq(users.id, ctx.userId));
    return { ok: true, avatarFileId: file.id };
  });

  app.delete('/me/avatar', async (req) => {
    const ctx = requireAuth(req);
    await db.update(users).set({ avatarFileId: null }).where(eq(users.id, ctx.userId));
    return { ok: true };
  });

  /** Any signed-in colleague may see profile photos. */
  app.get('/users/:id/avatar', { schema: { params: idParam } }, async (req, reply) => {
    requireAuth(req);
    const [row] = await db
      .select({ file: files })
      .from(users)
      .innerJoin(files, eq(files.id, users.avatarFileId))
      .where(eq(users.id, req.params.id));
    if (!row) throw notFound();
    reply.header('cache-control', 'private, max-age=86400');
    return streamFile(deps, reply, row.file, { inline: true });
  });

  app.get(
    '/directory',
    {
      schema: {
        querystring: paginationQuery.extend({
          q: z.string().trim().max(80).optional(),
          departmentId: z.uuid().optional(),
          teamId: z.uuid().optional(),
        }),
      },
    },
    async (req) => {
      requireAuth(req);
      const { page, pageSize, q, departmentId, teamId } = req.query;
      const conds = [eq(users.status, 'active')];
      if (q) conds.push(or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`), ilike(users.jobTitle, `%${q}%`))!);
      if (departmentId) {
        conds.push(
          or(
            inArray(users.id, db.select({ id: departmentMemberships.userId }).from(departmentMemberships).where(eq(departmentMemberships.departmentId, departmentId))),
            inArray(
              users.id,
              db.select({ id: teamMemberships.userId }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(eq(teams.departmentId, departmentId)),
            ),
          )!,
        );
      }
      if (teamId) conds.push(inArray(users.id, db.select({ id: teamMemberships.userId }).from(teamMemberships).where(eq(teamMemberships.teamId, teamId))));
      const where = and(...conds);
      const [rows, [count]] = await Promise.all([
        db.select().from(users).where(where).orderBy(asc(users.displayName)).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
      ]);
      const ids = rows.map((r) => r.id);
      const [memberships, presence] = await Promise.all([orgLabels(deps, ids), presenceForUsers(deps, ids)]);
      return {
        items: rows.map((r) => ({ ...toUserSummary(r), org: memberships.get(r.id) ?? [], presence: presence.get(r.id) ?? null })),
        page,
        pageSize,
        total: count?.n ?? 0,
      };
    },
  );

  app.get('/users/:id/profile', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    const [u] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!u) throw notFound('Colaborador não encontrado.');
    const labels = await orgLabels(deps, [u.id]);
    const presence = await presenceForUsers(deps, [u.id]);
    const theirDepts = new Set((labels.get(u.id) ?? []).map((l) => l.departmentId));
    const sharesDepartment = [...ctx.memberDepartmentIds].some((d) => theirDepts.has(d));
    // Phone numbers are shown to colleagues of the same department and to user administrators only.
    const showContact = u.id === ctx.userId || sharesDepartment || ctx.permissions.has('users.manage');
    return {
      ...toUserSummary(u),
      phone: showContact ? u.phone : null,
      contactRestricted: !showContact && !!u.phone,
      org: labels.get(u.id) ?? [],
      presence: presence.get(u.id) ?? null,
    };
  });
}

/** Department/team labels for a set of users. */
export async function orgLabels(deps: Deps, userIds: string[]) {
  const out = new Map<string, { departmentId: string; departmentName: string; teamId: string | null; teamName: string | null; role: string }[]>();
  if (userIds.length === 0) return out;
  const [d, t] = await Promise.all([
    deps.db
      .select({ userId: departmentMemberships.userId, departmentId: departments.id, departmentName: departments.name, role: departmentMemberships.role })
      .from(departmentMemberships)
      .innerJoin(departments, eq(departments.id, departmentMemberships.departmentId))
      .where(inArray(departmentMemberships.userId, userIds)),
    deps.db
      .select({ userId: teamMemberships.userId, teamId: teams.id, teamName: teams.name, departmentId: departments.id, departmentName: departments.name, role: teamMemberships.role })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .innerJoin(departments, eq(departments.id, teams.departmentId))
      .where(inArray(teamMemberships.userId, userIds)),
  ]);
  for (const r of d) {
    const list = out.get(r.userId) ?? [];
    list.push({ departmentId: r.departmentId, departmentName: r.departmentName, teamId: null, teamName: null, role: r.role });
    out.set(r.userId, list);
  }
  for (const r of t) {
    const list = out.get(r.userId) ?? [];
    list.push({ departmentId: r.departmentId, departmentName: r.departmentName, teamId: r.teamId, teamName: r.teamName, role: r.role });
    out.set(r.userId, list);
  }
  return out;
}
