import { computePresence, type PresenceView } from '@uon/shared';
import { and, eq, inArray, lte, gt, sql } from 'drizzle-orm';
import type { Deps } from '../../deps.js';
import type { Tx } from '../../db/client.js';
import { absenceSchedules, departmentMemberships, teamMemberships, teams, userPresence, users } from '../../db/schema/index.js';
import type { AuthContext } from '../../authz/context.js';
import { notify } from '../notifications/service.js';

export async function presenceForUsers(deps: Deps, userIds: string[]): Promise<Map<string, PresenceView>> {
  const out = new Map<string, PresenceView>();
  if (userIds.length === 0) return out;
  const [rows, absences] = await Promise.all([
    deps.db.select().from(userPresence).where(inArray(userPresence.userId, userIds)),
    deps.db
      .select({ userId: absenceSchedules.userId })
      .from(absenceSchedules)
      .where(and(inArray(absenceSchedules.userId, userIds), eq(absenceSchedules.status, 'active'))),
  ]);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const absent = new Set(absences.map((a) => a.userId));
  const connected = deps.realtime.connectedUserIds();
  for (const id of userIds) {
    const r = byUser.get(id);
    const p = computePresence({
      connected: connected.has(id),
      idle: deps.realtime.idleUsers.has(id),
      manualStatus: r?.manualStatus ?? null,
      manualExpiresAt: r?.manualExpiresAt ?? null,
      absenceActive: absent.has(id),
    });
    out.set(id, {
      userId: id,
      ...p,
      message: r?.statusMessage ?? null,
      lastSeenAt: r?.lastSeenAt?.toISOString() ?? null,
    });
  }
  return out;
}

/** Publishes the user's current effective status to every signed-in client. */
export async function broadcastPresence(deps: Deps, userId: string) {
  const p = (await presenceForUsers(deps, [userId])).get(userId);
  if (p) deps.realtime.toAuthenticated('presence:update', p);
}

export async function touchLastSeen(db: Tx, userId: string) {
  await db
    .insert(userPresence)
    .values({ userId, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: userPresence.userId, set: { lastSeenAt: new Date() } });
}

/** Can `viewer` see the details (message, substitute) of `ownerId`'s absence? */
export async function canSeeAbsence(deps: Deps, viewer: AuthContext, ownerId: string, visibility: 'company' | 'department' | 'team') {
  if (viewer.userId === ownerId || visibility === 'company') return true;
  if (visibility === 'team') {
    const rows = await deps.db.select({ teamId: teamMemberships.teamId }).from(teamMemberships).where(eq(teamMemberships.userId, ownerId));
    return rows.some((r) => viewer.memberTeamIds.has(r.teamId));
  }
  const [d, t] = await Promise.all([
    deps.db.select({ id: departmentMemberships.departmentId }).from(departmentMemberships).where(eq(departmentMemberships.userId, ownerId)),
    deps.db.select({ id: teams.departmentId }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(eq(teamMemberships.userId, ownerId)),
  ]);
  return [...d, ...t].some((r) => viewer.memberDepartmentIds.has(r.id));
}

/**
 * Server-side absence lifecycle. Called by the scheduler every minute (and right after a user
 * creates or changes an absence), so activation doesn't depend on any browser being open.
 */
export async function runAbsenceTransitions(deps: Deps, now = new Date()) {
  const activated = await deps.db
    .update(absenceSchedules)
    .set({ status: 'active' })
    .where(and(eq(absenceSchedules.status, 'scheduled'), lte(absenceSchedules.startsAt, now), gt(absenceSchedules.endsAt, now)))
    .returning();
  const ended = await deps.db
    .update(absenceSchedules)
    .set({ status: 'ended' })
    .where(and(inArray(absenceSchedules.status, ['scheduled', 'active']), lte(absenceSchedules.endsAt, now)))
    .returning();
  for (const a of activated) {
    await broadcastPresence(deps, a.userId);
    if (a.substituteUserId) {
      const [owner] = await deps.db.select({ name: users.displayName }).from(users).where(eq(users.id, a.userId));
      await notify(deps, {
        userIds: [a.substituteUserId],
        category: 'absence',
        title: `Você é o contato substituto de ${owner?.name ?? 'um colega'} durante a ausência`,
        link: `/pessoas/${a.userId}`,
        resourceType: 'absence',
        resourceId: a.id,
      });
    }
  }
  for (const a of ended) await broadcastPresence(deps, a.userId);
  // Expired manual statuses fall back to automatic presence.
  const expired = await deps.db
    .update(userPresence)
    .set({ manualStatus: null, manualExpiresAt: null })
    .where(and(sql`${userPresence.manualExpiresAt} IS NOT NULL`, lte(userPresence.manualExpiresAt, now)))
    .returning({ userId: userPresence.userId });
  for (const e of expired) await broadcastPresence(deps, e.userId);
  return { activated: activated.length, ended: ended.length };
}
