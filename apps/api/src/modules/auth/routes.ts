import { devLoginBody } from '@uon/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EntraClaimError, type EntraProvider, verifyEntraClaims } from '../../auth/entra.js';
import { createSession, revokeSession, sessionCookieName } from '../../auth/sessions.js';
import { authFlows, oauthTokens, userIdentities, users } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { encrypt, safeEqual } from '../../lib/crypto.js';
import { AppError, unauthorized } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';
import * as oidc from 'openid-client';


/** Only same-site relative paths are accepted as post-login destinations (no open redirect). */
export function safeReturnTo(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return '/';
  return v.slice(0, 500);
}

export function registerAuthRoutes(app: App, deps: Deps, entra: EntraProvider) {
  const { db, env } = deps;
  const AUTH_RATE = { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' };

  function setSessionCookie(reply: import('fastify').FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(sessionCookieName(env), token, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  app.get('/auth/providers', async () => {
    const demoUsers = env.devLoginEnabled
      ? await db
          .select({ email: users.email, displayName: users.displayName, jobTitle: users.jobTitle })
          .from(users)
          .where(and(eq(users.isDemo, true), eq(users.status, 'active')))
          .orderBy(users.displayName)
      : [];
    return { devLoginEnabled: env.devLoginEnabled, entraEnabled: entra.enabled, demoUsers };
  });

  /**
   * Development login. Disabled unless AUTH_DEV_LOGIN_ENABLED=true outside production, and even
   * then it only accepts accounts flagged as demonstration (is_demo) with the shared test password.
   */
  app.post('/auth/dev-login', { schema: { body: devLoginBody }, config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    if (!env.devLoginEnabled) throw new AppError(404, 'not_found', 'Login de desenvolvimento desativado.');
    const email = req.body.email.toLowerCase();
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    const passwordOk = safeEqual(req.body.password, env.DEV_LOGIN_PASSWORD!);
    if (!user || !user.isDemo || user.status !== 'active' || !passwordOk) {
      await recordAudit(db, {
        actorLabel: email,
        action: 'auth.dev_login',
        outcome: 'failure',
        metadata: { reason: !user ? 'unknown_user' : !user.isDemo ? 'not_demo' : user.status !== 'active' ? 'inactive' : 'bad_password' },
        meta: reqMeta(req),
      });
      throw unauthorized('Credenciais de demonstração inválidas.');
    }
    // Update first: the founder's identities may not be inserted outside the recovery procedure.
    const touched = await db
      .update(userIdentities)
      .set({ lastLoginAt: new Date() })
      .where(and(eq(userIdentities.provider, 'dev'), eq(userIdentities.subject, user.id)))
      .returning({ id: userIdentities.id });
    if (touched.length === 0) {
      await db.insert(userIdentities).values({ userId: user.id, provider: 'dev', subject: user.id, emailAtLink: user.email, lastLoginAt: new Date() });
    }
    const s = await createSession(db, env, { userId: user.id, authMethod: 'dev', ip: req.ip, userAgent: req.headers['user-agent'] });
    await recordAudit(db, {
      actor: { userId: user.id, user: { email: user.email } as never },
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'success',
      metadata: { method: 'dev' },
      meta: reqMeta(req),
    });
    setSessionCookie(reply, s.token, s.expiresAt);
    return { ok: true };
  });

  app.get(
    '/auth/entra/login',
    { schema: { querystring: z.object({ returnTo: z.string().max(500).optional() }) }, config: { rateLimit: AUTH_RATE } },
    async (req, reply) => {
      if (!entra.enabled) throw new AppError(404, 'not_found', 'Login corporativo não configurado.');
      const flow = { state: oidc.randomState(), nonce: oidc.randomNonce(), codeVerifier: oidc.randomPKCECodeVerifier() };
      await db.insert(authFlows).values({
        ...flow,
        returnTo: safeReturnTo(req.query.returnTo),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      const url = await entra.buildLoginUrl(flow);
      return reply.redirect(url.href, 302);
    },
  );

  app.get('/auth/entra/callback', { config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    if (!entra.enabled) throw new AppError(404, 'not_found', 'Login corporativo não configurado.');
    const fail = async (reason: string, message: string, extra?: Record<string, unknown>) => {
      await recordAudit(db, { action: 'auth.entra_login', outcome: 'failure', metadata: { reason, ...extra }, meta: reqMeta(req) });
      return reply.redirect(`/login?erro=${encodeURIComponent(message)}`, 302);
    };
    const query = req.query as Record<string, string | undefined>;
    if (query.error) return fail('provider_error', 'O login corporativo foi cancelado ou recusado.', { error: query.error });
    const state = query.state;
    if (!state) return fail('missing_state', 'Requisição de login inválida.');
    const [flow] = await db.delete(authFlows).where(eq(authFlows.state, state)).returning();
    if (!flow || flow.expiresAt < new Date()) return fail('unknown_state', 'A tentativa de login expirou. Tente novamente.');

    let identity;
    let tokens;
    try {
      const currentUrl = new URL(req.url, env.ENTRA_REDIRECT_URI);
      const result = await entra.exchangeCode(currentUrl, flow);
      tokens = result.tokens;
      identity = verifyEntraClaims(result.claims, env);
    } catch (err) {
      if (err instanceof EntraClaimError) return fail(err.reason, err.message);
      req.log.warn({ err }, 'entra code exchange failed');
      return fail('exchange_failed', 'Não foi possível validar o login corporativo.');
    }

    // 1) Known identity: match by the stable object id only.
    const [linked] = await db
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, 'entra'), eq(userIdentities.tenantId, identity.tenantId), eq(userIdentities.subject, identity.objectId)))
      .limit(1);
    let userId = linked?.userId ?? null;

    // 2) First login of a pre-provisioned account: link by e-mail (configurable). Never grants roles.
    if (!userId && env.ENTRA_LINK_BY_EMAIL && identity.email) {
      const [candidate] = await db
        .select({ id: users.id })
        .from(users)
        .leftJoin(userIdentities, and(eq(userIdentities.userId, users.id), eq(userIdentities.provider, 'entra')))
        .where(and(sql`lower(${users.email}) = ${identity.email}`, isNull(userIdentities.id), eq(users.isDemo, false)))
        .limit(1);
      if (candidate) {
        try {
          await db.insert(userIdentities).values({
            userId: candidate.id,
            provider: 'entra',
            tenantId: identity.tenantId,
            subject: identity.objectId,
            emailAtLink: identity.email,
          });
        } catch {
          return fail('link_refused', 'Não foi possível associar esta conta. Contate a administração.');
        }
        userId = candidate.id;
        await recordAudit(db, { actorLabel: identity.email, action: 'identity.linked', resourceType: 'user', resourceId: userId, outcome: 'success', metadata: { provider: 'entra', oid: identity.objectId }, meta: reqMeta(req) });
      }
    }

    // 3) Optional just-in-time provisioning as a regular employee without any memberships.
    if (!userId && env.ENTRA_AUTO_PROVISION && identity.email) {
      const [company] = await db.execute(sql`SELECT id FROM companies ORDER BY created_at LIMIT 1`).then((r) => r.rows as { id: string }[]);
      if (company) {
        const [created] = await db
          .insert(users)
          .values({ companyId: company.id, email: identity.email, displayName: identity.name ?? identity.email })
          .returning({ id: users.id });
        await db.insert(userIdentities).values({ userId: created!.id, provider: 'entra', tenantId: identity.tenantId, subject: identity.objectId, emailAtLink: identity.email });
        userId = created!.id;
        await recordAudit(db, { actorLabel: identity.email, action: 'user.provisioned', resourceType: 'user', resourceId: userId, outcome: 'success', metadata: { provider: 'entra' }, meta: reqMeta(req) });
      }
    }

    if (!userId) return fail('not_provisioned', 'Sua conta ainda não foi cadastrada no UON CONNECT. Procure a administração.', { email: identity.email });
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.status !== 'active') return fail('inactive', 'Sua conta está desativada.', { userId });

    await db.update(userIdentities).set({ lastLoginAt: new Date() })
      .where(and(eq(userIdentities.provider, 'entra'), eq(userIdentities.subject, identity.objectId)));

    if ((env.GRAPH_CALENDAR_ENABLED || env.GRAPH_TEAMS_MEETINGS_ENABLED) && tokens.access_token) {
      const key = env.TOKEN_ENCRYPTION_KEY!;
      const row = {
        accessTokenEnc: encrypt(tokens.access_token, key),
        refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token, key) : null,
        scopes: tokens.scope ?? entra.scopes(),
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      };
      await db.insert(oauthTokens).values({ userId, ...row }).onConflictDoUpdate({ target: oauthTokens.userId, set: row });
    }

    const s = await createSession(db, env, { userId, authMethod: 'entra', ip: req.ip, userAgent: req.headers['user-agent'] });
    await recordAudit(db, { actor: { userId, user: { email: user.email } as never }, action: 'auth.login', resourceType: 'user', resourceId: userId, outcome: 'success', metadata: { method: 'entra' }, meta: reqMeta(req) });
    setSessionCookie(reply, s.token, s.expiresAt);
    return reply.redirect(flow.returnTo ?? '/', 302);
  });

  app.post('/auth/logout', async (req, reply) => {
    const ctx = requireAuth(req);
    await revokeSession(db, ctx.sessionId, 'logout');
    await recordAudit(db, { actor: ctx, action: 'auth.logout', outcome: 'success', meta: reqMeta(req) });
    reply.clearCookie(sessionCookieName(env), { path: '/' });
    const entraLogoutUrl = ctx.authMethod === 'entra' ? await entra.logoutUrl() : null;
    return { ok: true, entraLogoutUrl };
  });
}
