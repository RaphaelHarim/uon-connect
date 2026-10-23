import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import type { Tx } from '../../db/client.js';
import { localAuthTokens } from '../../db/schema/index.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';

export type LocalTokenPurpose = 'invite' | 'reset' | 'mfa';

export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

/**
 * Issues a one-time token and returns the raw value (only its hash is stored). Issuing an
 * invitation or reset link invalidates any earlier unused link of the same user.
 */
export async function issueLocalToken(
  db: Tx,
  input: { userId: string; purpose: LocalTokenPurpose; ttlMs: number; createdBy?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  if (input.purpose !== 'mfa') {
    await db
      .update(localAuthTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(localAuthTokens.userId, input.userId), inArray(localAuthTokens.purpose, ['invite', 'reset']), isNull(localAuthTokens.usedAt)));
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + input.ttlMs);
  await db.insert(localAuthTokens).values({
    id: sha256Hex(token),
    userId: input.userId,
    purpose: input.purpose,
    createdBy: input.createdBy ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

/** Looks a token up without consuming it. */
export async function findLocalToken(db: Tx, token: string, purposes: LocalTokenPurpose[]) {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select()
    .from(localAuthTokens)
    .where(and(eq(localAuthTokens.id, sha256Hex(token)), inArray(localAuthTokens.purpose, purposes), isNull(localAuthTokens.usedAt), gt(localAuthTokens.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Marks a token as used. Returns false when another request consumed it first. */
export async function consumeLocalToken(db: Tx, id: string): Promise<boolean> {
  const rows = await db
    .update(localAuthTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(localAuthTokens.id, id), isNull(localAuthTokens.usedAt)))
    .returning({ id: localAuthTokens.id });
  return rows.length === 1;
}

export async function countChallengeAttempt(db: Tx, id: string): Promise<number> {
  const [row] = await db
    .update(localAuthTokens)
    .set({ attempts: sql`${localAuthTokens.attempts} + 1` })
    .where(eq(localAuthTokens.id, id))
    .returning({ attempts: localAuthTokens.attempts });
  return row?.attempts ?? Number.POSITIVE_INFINITY;
}

/**
 * The token travels in the URL fragment, which browsers never send to the server, so it stays out
 * of access logs, proxies and Referer headers.
 */
export const passwordLink = (env: Env, token: string) => `${env.APP_BASE_URL.replace(/\/$/, '')}/definir-senha#${token}`;
