import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Tx } from '../db/client.js';
import { sessions } from '../db/schema/index.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';

export const SESSION_COOKIE = 'uon_session';
export const sessionCookieName = (env: Env) => (env.cookieSecure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE);

export async function createSession(
  db: Tx,
  env: Env,
  input: { userId: string; authMethod: 'entra' | 'dev'; ip?: string; userAgent?: string },
) {
  const token = randomToken(32);
  const id = sha256Hex(token);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
  await db.insert(sessions).values({
    id,
    userId: input.userId,
    authMethod: input.authMethod,
    csrfToken,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
    expiresAt,
  });
  return { token, id, csrfToken, expiresAt };
}

export interface ValidSession {
  id: string;
  userId: string;
  csrfToken: string;
  authMethod: 'entra' | 'dev';
}

/** Returns the session for a raw cookie token, enforcing absolute and idle expiry. */
export async function resolveSession(db: Tx, env: Env, token: string): Promise<ValidSession | null> {
  if (!token || token.length > 100) return null;
  const id = sha256Hex(token);
  const now = new Date();
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  const idleLimit = new Date(now.getTime() - env.SESSION_IDLE_MINUTES * 60_000);
  if (row.lastSeenAt < idleLimit) {
    await db.update(sessions).set({ revokedAt: now, revokedReason: 'idle_timeout' }).where(eq(sessions.id, id));
    return null;
  }
  // Avoid a write per request: refresh the idle timer at most once a minute.
  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  return { id: row.id, userId: row.userId, csrfToken: row.csrfToken, authMethod: row.authMethod };
}

export async function revokeSession(db: Tx, id: string, reason: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(db: Tx, userId: string, reason: string) {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function purgeExpiredSessions(db: Tx, olderThanDays = 90) {
  const limit = new Date(Date.now() - olderThanDays * 86_400_000);
  await db.delete(sessions).where(or(lt(sessions.expiresAt, limit), lt(sessions.revokedAt, limit)));
}
