import {
  changePasswordBody,
  idParam,
  localLoginBody,
  mfaCodeBody,
  mfaDisableBody,
  mfaLoginBody,
  oneTimeTokenBody,
  setPasswordBody,
} from '@uon/shared';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import {
  getDummyHash,
  hashPassword,
  newTotpSecret,
  otpauthUri,
  passwordProblem,
  verifyPassword,
  verifyTotp,
} from '../../auth/local.js';
import { createSession, revokeUserSessions, sessionCookieName } from '../../auth/sessions.js';
import { localCredentials, sessions, userIdentities, users } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import type { Mailer } from '../../jobs/mailer.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError, badRequest, unauthorized } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';
import { assertCanAdminister, loadUser } from '../users/service.js';
import {
  consumeLocalToken,
  countChallengeAttempt,
  findLocalToken,
  issueLocalToken,
  MFA_CHALLENGE_MAX_ATTEMPTS,
  MFA_CHALLENGE_TTL_MS,
  passwordLink,
} from './local-service.js';

const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos, ou conta temporariamente bloqueada.';

/**
 * Username/password accounts, enabled with LOCAL_AUTH_ENABLED=true. There is no self sign-up:
 * an administrator issues a one-time invitation link and the person chooses their own password.
 */
export function registerLocalAuthRoutes(app: App, deps: Deps, extras: { mailer: Mailer }) {
  const { db, env } = deps;
  const AUTH_RATE = { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' };
  const key = () => env.TOKEN_ENCRYPTION_KEY!;
  const ensureEnabled = () => {
    if (!env.localAuthEnabled) throw new AppError(404, 'not_found', 'Login com usuário e senha desativado.');
  };

  function setSessionCookie(reply: import('fastify').FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(sessionCookieName(env), token, { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/', expires: expiresAt });
  }

  async function startSession(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, user: { id: string; email: string }, mfa: boolean) {
    await db.update(userIdentities).set({ lastLoginAt: new Date() })
      .where(and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, 'local')));
    const s = await createSession(db, env, { userId: user.id, authMethod: 'local', mfa, ip: req.ip, userAgent: req.headers['user-agent'] });
    await recordAudit(db, { actor: { userId: user.id, user: { email: user.email } as never }, action: 'auth.login', resourceType: 'user', resourceId: user.id, outcome: 'success', metadata: { method: 'local', mfa }, meta: reqMeta(req) });
    setSessionCookie(reply, s.token, s.expiresAt);
  }

  /* ---------------------------------------------------------------- login */

  app.post('/auth/login', { schema: { body: localLoginBody }, config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    ensureEnabled();
    const email = req.body.email.toLowerCase();
    const [row] = await db
      .select({ user: users, cred: localCredentials })
      .from(users)
      .innerJoin(localCredentials, eq(localCredentials.userId, users.id))
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    // Always run the hash so response time doesn't reveal whether the account exists.
    const passwordOk = await verifyPassword(req.body.password, row?.cred.passwordHash ?? (await getDummyHash()));
    const now = new Date();
    const locked = !!row?.cred.lockedUntil && row.cred.lockedUntil > now;

    const fail = async (reason: string) => {
      await recordAudit(db, { actorLabel: email, action: 'auth.local_login', resourceType: row ? 'user' : undefined, resourceId: row?.user.id, outcome: 'failure', metadata: { reason }, meta: reqMeta(req) });
      throw unauthorized(GENERIC_LOGIN_ERROR);
    };
    if (!row || !row.cred.passwordHash) return fail(!row ? 'unknown_user' : 'invite_pending');
    if (locked) return fail('locked');
    if (!passwordOk) {
      const [updated] = await db
        .update(localCredentials)
        .set({ failedAttempts: sql`${localCredentials.failedAttempts} + 1` })
        .where(eq(localCredentials.userId, row.user.id))
        .returning({ failedAttempts: localCredentials.failedAttempts });
      if ((updated?.failedAttempts ?? 0) >= env.LOCAL_AUTH_MAX_ATTEMPTS) {
        await db.update(localCredentials)
          .set({ failedAttempts: 0, lockedUntil: new Date(now.getTime() + env.LOCAL_AUTH_LOCK_MINUTES * 60_000) })
          .where(eq(localCredentials.userId, row.user.id));
        await recordAudit(db, { actorLabel: email, action: 'auth.local_locked', resourceType: 'user', resourceId: row.user.id, outcome: 'success', metadata: { minutes: env.LOCAL_AUTH_LOCK_MINUTES }, meta: reqMeta(req) });
      }
      return fail('bad_password');
    }
    if (row.user.status !== 'active') return fail('inactive');
    if (row.user.isDemo) return fail('demo_account');

    await db.update(localCredentials).set({ failedAttempts: 0, lockedUntil: null }).where(eq(localCredentials.userId, row.user.id));

    if (row.cred.totpEnabledAt && row.cred.totpSecretEnc) {
      const { token } = await issueLocalToken(db, { userId: row.user.id, purpose: 'mfa', ttlMs: MFA_CHALLENGE_TTL_MS });
      return { ok: false, mfaRequired: true, challenge: token };
    }
    await startSession(req, reply, row.user, false);
    return { ok: true, mfaRequired: false };
  });

  app.post('/auth/login/mfa', { schema: { body: mfaLoginBody }, config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    ensureEnabled();
    const challenge = await findLocalToken(db, req.body.challenge, ['mfa']);
    if (!challenge) throw unauthorized('A verificação expirou. Entre novamente com e-mail e senha.');
    const attempts = await countChallengeAttempt(db, challenge.id);
    if (attempts > MFA_CHALLENGE_MAX_ATTEMPTS) {
      await consumeLocalToken(db, challenge.id);
      throw unauthorized('Muitas tentativas. Entre novamente com e-mail e senha.');
    }
    const [row] = await db
      .select({ user: users, cred: localCredentials })
      .from(users)
      .innerJoin(localCredentials, eq(localCredentials.userId, users.id))
      .where(eq(users.id, challenge.userId))
      .limit(1);
    if (!row || row.user.status !== 'active' || !row.cred.totpSecretEnc || !row.cred.totpEnabledAt) {
      await consumeLocalToken(db, challenge.id);
      throw unauthorized('A verificação expirou. Entre novamente com e-mail e senha.');
    }
    const step = verifyTotp(decrypt(row.cred.totpSecretEnc, key()), req.body.code, row.cred.totpLastStep);
    // The conditional update makes concurrent use of the same code impossible.
    const accepted = step !== null && (await db
      .update(localCredentials)
      .set({ totpLastStep: step })
      .where(and(eq(localCredentials.userId, row.user.id), or(isNull(localCredentials.totpLastStep), sql`${localCredentials.totpLastStep} < ${step}`)))
      .returning({ userId: localCredentials.userId })).length === 1;
    if (!accepted) {
      await recordAudit(db, { actorLabel: row.user.email, action: 'auth.local_mfa', resourceType: 'user', resourceId: row.user.id, outcome: 'failure', metadata: { reason: 'bad_code' }, meta: reqMeta(req) });
      throw unauthorized('Código inválido.');
    }
    if (!(await consumeLocalToken(db, challenge.id))) throw unauthorized('A verificação expirou. Entre novamente com e-mail e senha.');
    await startSession(req, reply, row.user, true);
    return { ok: true };
  });

  /* ---------------------------------------------------------------- invitation / reset links */

  app.post('/auth/password/inspect', { schema: { body: oneTimeTokenBody }, config: { rateLimit: AUTH_RATE } }, async (req) => {
    ensureEnabled();
    const t = await findLocalToken(db, req.body.token, ['invite', 'reset']);
    if (!t) throw new AppError(410, 'link_expired', 'Este link é inválido, já foi usado ou expirou. Peça um novo à administração.');
    const [u] = await db.select({ email: users.email, displayName: users.displayName, status: users.status }).from(users).where(eq(users.id, t.userId));
    if (!u || u.status !== 'active') throw new AppError(410, 'link_expired', 'Este link é inválido, já foi usado ou expirou. Peça um novo à administração.');
    return { purpose: t.purpose, email: u.email, displayName: u.displayName, expiresAt: t.expiresAt };
  });

  app.post('/auth/password/set', { schema: { body: setPasswordBody }, config: { rateLimit: AUTH_RATE } }, async (req) => {
    ensureEnabled();
    const t = await findLocalToken(db, req.body.token, ['invite', 'reset']);
    const expired = () => new AppError(410, 'link_expired', 'Este link é inválido, já foi usado ou expirou. Peça um novo à administração.');
    if (!t) throw expired();
    const user = await loadUser(deps, t.userId);
    if (user.status !== 'active') throw expired();
    const problem = passwordProblem(req.body.password, user.email);
    if (problem) throw badRequest(problem);
    if (!(await consumeLocalToken(db, t.id))) throw expired();

    const hash = await hashPassword(req.body.password);
    await db.update(localCredentials)
      .set({ passwordHash: hash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null })
      .where(eq(localCredentials.userId, user.id));
    const [identity] = await db.select({ id: userIdentities.id }).from(userIdentities)
      .where(and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, 'local')));
    if (!identity) {
      await db.insert(userIdentities).values({ userId: user.id, provider: 'local', subject: user.id, emailAtLink: user.email });
    }
    // A new password ends every existing session of the account.
    const revoked = await revokeUserSessions(db, user.id, 'password_set');
    await recordAudit(db, { actor: { userId: user.id, user: { email: user.email } as never }, action: t.purpose === 'invite' ? 'auth.local_invite_accepted' : 'auth.local_password_reset', resourceType: 'user', resourceId: user.id, outcome: 'success', metadata: { revokedSessions: revoked }, meta: reqMeta(req) });
    return { ok: true, email: user.email };
  });

  /* ---------------------------------------------------------------- self-service */

  async function myCredential(userId: string) {
    const [c] = await db.select().from(localCredentials).where(eq(localCredentials.userId, userId));
    return c ?? null;
  }

  app.get('/me/security', async (req) => {
    const ctx = requireAuth(req);
    const c = env.localAuthEnabled ? await myCredential(ctx.userId) : null;
    return {
      localAuthEnabled: env.localAuthEnabled,
      adminMfaRequired: env.LOCAL_AUTH_ADMIN_MFA_REQUIRED,
      adminMfaPending: ctx.adminMfaPending,
      local: c
        ? { hasPassword: !!c.passwordHash, passwordChangedAt: c.passwordChangedAt, mfaEnabled: !!c.totpEnabledAt, mfaEnabledAt: c.totpEnabledAt }
        : null,
    };
  });

  app.post('/me/password', { schema: { body: changePasswordBody }, config: { rateLimit: AUTH_RATE } }, async (req) => {
    ensureEnabled();
    const ctx = requireAuth(req);
    const c = await myCredential(ctx.userId);
    if (!c?.passwordHash) throw badRequest('Esta conta não usa senha local.');
    if (!(await verifyPassword(req.body.currentPassword, c.passwordHash))) {
      await recordAudit(db, { actor: ctx, action: 'auth.local_password_change', resourceType: 'user', resourceId: ctx.userId, outcome: 'failure', metadata: { reason: 'bad_password' }, meta: reqMeta(req) });
      throw badRequest('A senha atual está incorreta.');
    }
    const problem = passwordProblem(req.body.newPassword, ctx.user.email);
    if (problem) throw badRequest(problem);
    if (await verifyPassword(req.body.newPassword, c.passwordHash)) throw badRequest('A nova senha deve ser diferente da atual.');
    await db.update(localCredentials).set({ passwordHash: await hashPassword(req.body.newPassword), passwordChangedAt: new Date() }).where(eq(localCredentials.userId, ctx.userId));
    // Keep the current session, end the others.
    const others = await db.update(sessions).set({ revokedAt: new Date(), revokedReason: 'password_changed' })
      .where(and(eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt), ne(sessions.id, ctx.sessionId)))
      .returning({ id: sessions.id });
    await recordAudit(db, { actor: ctx, action: 'auth.local_password_change', resourceType: 'user', resourceId: ctx.userId, outcome: 'success', metadata: { revokedSessions: others.length }, meta: reqMeta(req) });
    return { ok: true, revokedSessions: others.length };
  });

  app.post('/me/mfa/setup', async (req) => {
    ensureEnabled();
    const ctx = requireAuth(req);
    const c = await myCredential(ctx.userId);
    if (!c?.passwordHash) throw badRequest('Esta conta não usa senha local.');
    if (c.totpEnabledAt) throw badRequest('A verificação em duas etapas já está ativa. Desative antes de configurar outro aparelho.');
    const secret = newTotpSecret();
    await db.update(localCredentials).set({ totpSecretEnc: encrypt(secret, key()), totpLastStep: null }).where(eq(localCredentials.userId, ctx.userId));
    return { secret, otpauthUri: otpauthUri(secret, ctx.user.email) };
  });

  app.post('/me/mfa/enable', { schema: { body: mfaCodeBody }, config: { rateLimit: AUTH_RATE } }, async (req) => {
    ensureEnabled();
    const ctx = requireAuth(req);
    const c = await myCredential(ctx.userId);
    if (!c?.totpSecretEnc || c.totpEnabledAt) throw badRequest('Inicie a configuração da verificação em duas etapas primeiro.');
    const step = verifyTotp(decrypt(c.totpSecretEnc, key()), req.body.code, c.totpLastStep);
    if (step === null) throw badRequest('Código inválido. Confira o horário do celular e tente o código atual.');
    await db.update(localCredentials).set({ totpEnabledAt: new Date(), totpLastStep: step }).where(eq(localCredentials.userId, ctx.userId));
    // The user just proved the second factor in this session.
    await db.update(sessions).set({ mfa: true }).where(eq(sessions.id, ctx.sessionId));
    await recordAudit(db, { actor: ctx, action: 'auth.local_mfa_enabled', resourceType: 'user', resourceId: ctx.userId, outcome: 'success', meta: reqMeta(req) });
    return { ok: true };
  });

  app.post('/me/mfa/disable', { schema: { body: mfaDisableBody }, config: { rateLimit: AUTH_RATE } }, async (req) => {
    ensureEnabled();
    const ctx = requireAuth(req);
    const c = await myCredential(ctx.userId);
    if (!c?.passwordHash || !c.totpEnabledAt || !c.totpSecretEnc) throw badRequest('A verificação em duas etapas não está ativa.');
    const passwordOk = await verifyPassword(req.body.password, c.passwordHash);
    const step = verifyTotp(decrypt(c.totpSecretEnc, key()), req.body.code, c.totpLastStep);
    if (!passwordOk || step === null) {
      await recordAudit(db, { actor: ctx, action: 'auth.local_mfa_disabled', resourceType: 'user', resourceId: ctx.userId, outcome: 'failure', meta: reqMeta(req) });
      throw badRequest('Senha ou código incorretos.');
    }
    await db.update(localCredentials).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null }).where(eq(localCredentials.userId, ctx.userId));
    await db.update(sessions).set({ mfa: false }).where(and(eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt)));
    await recordAudit(db, { actor: ctx, action: 'auth.local_mfa_disabled', resourceType: 'user', resourceId: ctx.userId, outcome: 'success', meta: reqMeta(req) });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- administration */

  app.get('/admin/users/:id/local', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    if (!ctx.permissions.has('users.manage')) throw new AppError(403, 'forbidden', 'Você não tem permissão para esta ação.');
    const c = env.localAuthEnabled ? await myCredential(req.params.id) : null;
    return {
      localAuthEnabled: env.localAuthEnabled,
      emailConfigured: extras.mailer.configured,
      credential: c
        ? {
            hasPassword: !!c.passwordHash,
            passwordChangedAt: c.passwordChangedAt,
            mfaEnabled: !!c.totpEnabledAt,
            lockedUntil: c.lockedUntil && c.lockedUntil > new Date() ? c.lockedUntil : null,
          }
        : null,
    };
  });

  /**
   * Issues an invitation (first access) or a password reset link. The link is returned once to the
   * administrator and, when e-mail is configured, also sent to the user. The founder is never a
   * valid target (see docs/RECOVERY.md), and the database refuses it as well.
   */
  app.post('/admin/users/:id/local-access', { schema: { params: idParam }, config: { rateLimit: AUTH_RATE } }, async (req) => {
    ensureEnabled();
    const ctx = requireAuth(req);
    const target = await loadUser(deps, req.params.id);
    await assertCanAdminister(deps, ctx, target, 'auth.local_link_issued', reqMeta(req));
    if (target.status !== 'active') throw badRequest('Reative a conta antes de enviar um link de acesso.');
    if (target.isDemo) throw badRequest('Contas de demonstração não usam senha local.');

    const cred = (await myCredential(target.id)) ?? (await db.insert(localCredentials).values({ userId: target.id }).returning())[0]!;
    const purpose = cred.passwordHash ? 'reset' : 'invite';
    const ttlMs = (purpose === 'invite' ? env.LOCAL_AUTH_INVITE_TTL_HOURS : 24) * 3_600_000;
    const { token, expiresAt } = await issueLocalToken(db, { userId: target.id, purpose, ttlMs, createdBy: ctx.userId });
    const link = passwordLink(env, token);

    let emailed = false;
    if (extras.mailer.configured) {
      const subject = purpose === 'invite' ? 'Seu acesso ao UON CONNECT' : 'Redefinição de senha do UON CONNECT';
      const intro = purpose === 'invite'
        ? `Olá, ${target.displayName}. Você foi convidado(a) para o UON CONNECT. Defina sua senha pelo link abaixo.`
        : `Olá, ${target.displayName}. Foi solicitada a redefinição da sua senha do UON CONNECT.`;
      try {
        await extras.mailer.send({
          to: target.email,
          subject,
          text: `${intro}\n\n${link}\n\nO link vale até ${expiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} e só pode ser usado uma vez. Se você não esperava esta mensagem, avise a administração.`,
        });
        emailed = true;
      } catch (err) {
        req.log.warn({ err }, 'local access e-mail failed');
      }
    }
    await recordAudit(db, { actor: ctx, action: 'auth.local_link_issued', resourceType: 'user', resourceId: target.id, outcome: 'success', metadata: { purpose, emailed, expiresAt: expiresAt.toISOString() }, meta: reqMeta(req) });
    return { purpose, link, expiresAt, emailed };
  });

  app.post('/admin/users/:id/local-unlock', { schema: { params: idParam } }, async (req) => {
    ensureEnabled();
    const ctx = requireAuth(req);
    const target = await loadUser(deps, req.params.id);
    await assertCanAdminister(deps, ctx, target, 'auth.local_unlocked', reqMeta(req));
    await db.update(localCredentials).set({ failedAttempts: 0, lockedUntil: null }).where(eq(localCredentials.userId, target.id));
    await recordAudit(db, { actor: ctx, action: 'auth.local_unlocked', resourceType: 'user', resourceId: target.id, outcome: 'success', meta: reqMeta(req) });
    return { ok: true };
  });

  app.post('/admin/users/:id/mfa-reset', { schema: { params: idParam } }, async (req) => {
    ensureEnabled();
    const ctx = requireAuth(req);
    const target = await loadUser(deps, req.params.id);
    await assertCanAdminister(deps, ctx, target, 'auth.local_mfa_reset', reqMeta(req));
    await db.update(localCredentials).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null }).where(eq(localCredentials.userId, target.id));
    const revoked = await revokeUserSessions(db, target.id, 'mfa_reset');
    await recordAudit(db, { actor: ctx, action: 'auth.local_mfa_reset', resourceType: 'user', resourceId: target.id, outcome: 'success', metadata: { revokedSessions: revoked }, meta: reqMeta(req) });
    return { ok: true };
  });
}
