import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../app.js';
import { currentStep, hashPassword, passwordProblem, totpAt, verifyPassword, verifyTotp } from '../auth/local.js';
import { ConfigError, loadEnv } from '../config/env.js';
import { localAuthTokens } from '../db/schema/index.js';
import { type Client, clientFor, cookieFrom, createTestApp, login, userId } from './helpers.js';

const KEY = randomBytes(32).toString('base64');
const GOOD_PASSWORD = 'correto cavalo bateria grampo';
const API = '/api/v1';

let built: BuiltApp;
let admin: Client;
beforeAll(async () => {
  built = await createTestApp({ LOCAL_AUTH_ENABLED: 'true', TOKEN_ENCRYPTION_KEY: KEY, LOCAL_AUTH_MAX_ATTEMPTS: '3' });
  admin = await login(built, 'supreme');
});
afterAll(async () => {
  await built.app.close();
});

const post = (url: string, body: unknown, cookie?: string) =>
  built.app.inject({
    method: 'POST',
    url: `${API}${url}`,
    headers: { 'x-requested-with': 'uon-connect', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    payload: JSON.stringify(body),
  });

const tokenOf = (link: string) => link.split('#')[1]!;

let seq = 0;
async function invitedUser(): Promise<{ id: string; email: string; link: string }> {
  const email = `pessoa.local${++seq}.${Date.now()}@exemplo.test`;
  const created = await admin.post('/admin/users', { email, displayName: `Pessoa Local ${seq}` });
  expect(created.status).toBe(200);
  const id = created.json().id as string;
  const r = await admin.post(`/admin/users/${id}/local-access`);
  expect(r.status).toBe(200);
  expect(r.json().purpose).toBe('invite');
  return { id, email, link: r.json().link };
}

async function activeUser() {
  const u = await invitedUser();
  expect((await post('/auth/password/set', { token: tokenOf(u.link), password: GOOD_PASSWORD })).statusCode).toBe(200);
  return u;
}

async function localLogin(email: string, password = GOOD_PASSWORD) {
  return post('/auth/login', { email, password });
}

describe('password hashing and policy', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('uma senha longa qualquer');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('uma senha longa qualquer', h)).toBe(true);
    expect(await verifyPassword('outra senha longa qualquer', h)).toBe(false);
  });

  it('rejects short, common and e-mail-derived passwords', () => {
    expect(passwordProblem('curta', 'a@b.c')).toMatch(/12 caracteres/);
    expect(passwordProblem('123456789012', 'a@b.c')).toMatch(/comum/);
    expect(passwordProblem('aaaaaaaaaaaaaa', 'a@b.c')).toMatch(/único caractere/);
    expect(passwordProblem('joana.silva-2026!', 'joana.silva@uon.test')).toMatch(/e-mail/);
    expect(passwordProblem(GOOD_PASSWORD, 'joana@uon.test')).toBeNull();
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (base32 below), T = 59 s → 94287082.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  it('matches the RFC test vector', () => {
    expect(totpAt(RFC_SECRET, 1)).toBe('287082');
  });
  it('accepts ±1 step and refuses replay of an already used step', () => {
    const now = 1_800_000_000_000;
    const step = currentStep(now);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 3), null, now)).toBeNull();
  });
});

describe('local accounts: invitation and login', () => {
  it('admin invites, user sets a password once, then logs in', async () => {
    const u = await invitedUser();
    // The invitation also goes by e-mail when configured (test mailer).
    expect(built.mailer.outbox.some((m) => m.to === u.email && m.text.includes(u.link))).toBe(true);

    const inspect = await post('/auth/password/inspect', { token: tokenOf(u.link) });
    expect(inspect.statusCode).toBe(200);
    expect(inspect.json()).toMatchObject({ purpose: 'invite', email: u.email });

    expect((await localLogin(u.email)).statusCode).toBe(401); // invitation not accepted yet

    const weak = await post('/auth/password/set', { token: tokenOf(u.link), password: 'curta' });
    expect(weak.statusCode).toBe(400);
    expect((await post('/auth/password/set', { token: tokenOf(u.link), password: GOOD_PASSWORD })).statusCode).toBe(200);
    expect((await post('/auth/password/set', { token: tokenOf(u.link), password: GOOD_PASSWORD })).statusCode).toBe(410);

    expect((await localLogin(u.email, 'senha errada qualquer')).statusCode).toBe(401);
    const ok = await localLogin(u.email.toUpperCase());
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, mfaRequired: false });
    const c = await clientFor(built, cookieFrom(ok.headers));
    const me = (await c.get('/me')).json();
    expect(me.authMethod).toBe('local');
    expect(me.adminMfaPending).toBe(false);
  });

  it('uses the same generic error for unknown e-mails and wrong passwords', async () => {
    const u = await activeUser();
    const unknown = await localLogin('ninguem@exemplo.test');
    const wrong = await localLogin(u.email, 'senha errada qualquer');
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it('locks the account after repeated failures, even for the right password, until unlocked', async () => {
    const u = await activeUser();
    for (let i = 0; i < 3; i++) expect((await localLogin(u.email, 'senha errada qualquer')).statusCode).toBe(401);
    expect((await localLogin(u.email)).statusCode).toBe(401);
    const info = (await admin.get(`/admin/users/${u.id}/local`)).json();
    expect(info.credential.lockedUntil).not.toBeNull();
    expect((await admin.post(`/admin/users/${u.id}/local-unlock`)).status).toBe(200);
    expect((await localLogin(u.email)).statusCode).toBe(200);
  });

  it('a reset link replaces the password and ends existing sessions', async () => {
    const u = await activeUser();
    const session = await clientFor(built, cookieFrom((await localLogin(u.email)).headers));
    const r = await admin.post(`/admin/users/${u.id}/local-access`);
    expect(r.json().purpose).toBe('reset');
    const next = 'outra frase longa para senha';
    expect((await post('/auth/password/set', { token: tokenOf(r.json().link), password: next })).statusCode).toBe(200);
    expect((await session.get('/me')).status).toBe(401);
    expect((await localLogin(u.email)).statusCode).toBe(401);
    expect((await localLogin(u.email, next)).statusCode).toBe(200);
  });

  it('issuing a new link invalidates the previous one', async () => {
    const u = await invitedUser();
    const second = await admin.post(`/admin/users/${u.id}/local-access`);
    expect((await post('/auth/password/inspect', { token: tokenOf(u.link) })).statusCode).toBe(410);
    expect((await post('/auth/password/inspect', { token: tokenOf(second.json().link) })).statusCode).toBe(200);
  });

  it('lets the user change the password with the current one', async () => {
    const u = await activeUser();
    const c = await clientFor(built, cookieFrom((await localLogin(u.email)).headers));
    expect((await c.post('/me/password', { currentPassword: 'errada errada errada', newPassword: 'nova frase longa de senha' })).status).toBe(400);
    expect((await c.post('/me/password', { currentPassword: GOOD_PASSWORD, newPassword: 'nova frase longa de senha' })).status).toBe(200);
    expect((await c.get('/me')).status).toBe(200);
    expect((await localLogin(u.email, 'nova frase longa de senha')).statusCode).toBe(200);
  });

  it('refuses login for deactivated accounts', async () => {
    const u = await activeUser();
    expect((await admin.post(`/admin/users/${u.id}/status`, { status: 'inactive', reason: 'Teste de desativação' })).status).toBe(200);
    expect((await localLogin(u.email)).statusCode).toBe(401);
  });
});

describe('local accounts: two-step verification', () => {
  async function enableMfa(c: Client) {
    const setup = await c.post('/me/mfa/setup');
    expect(setup.status).toBe(200);
    const secret = setup.json().secret as string;
    expect(setup.json().otpauthUri).toContain('otpauth://totp/');
    expect((await c.post('/me/mfa/enable', { code: '000000' })).status).toBe(400);
    expect((await c.post('/me/mfa/enable', { code: totpAt(secret, currentStep()) })).status).toBe(200);
    return secret;
  }

  it('requires the code after the password and refuses a replayed code', async () => {
    const u = await activeUser();
    const c = await clientFor(built, cookieFrom((await localLogin(u.email)).headers));
    const secret = await enableMfa(c);

    const first = await localLogin(u.email);
    expect(first.statusCode).toBe(200);
    expect(first.json().mfaRequired).toBe(true);
    expect(first.headers['set-cookie']).toBeUndefined();
    const challenge = first.json().challenge;
    expect((await post('/auth/login/mfa', { challenge, code: '000000' })).statusCode).toBe(401);
    // The step used to enable 2FA is already consumed, so the next step's code is required.
    const code = totpAt(secret, currentStep() + 1);
    const ok = await post('/auth/login/mfa', { challenge, code });
    expect(ok.statusCode).toBe(200);
    expect((await (await clientFor(built, cookieFrom(ok.headers))).get('/me')).status).toBe(200);

    const again = (await localLogin(u.email)).json().challenge;
    expect((await post('/auth/login/mfa', { challenge: again, code })).statusCode).toBe(401);
    expect((await post('/auth/login/mfa', { challenge, code })).statusCode).toBe(401); // challenge already used
  });

  it('gives no admin permission to a local session without 2FA', async () => {
    const u = await activeUser();
    expect((await admin.post(`/admin/users/${u.id}/roles`, { role: 'platform_admin' })).status).toBe(200);
    const c = await clientFor(built, cookieFrom((await localLogin(u.email)).headers));
    const me = (await c.get('/me')).json();
    expect(me.roles).toContain('platform_admin');
    expect(me.adminMfaPending).toBe(true);
    expect(me.permissions).toEqual([]);
    expect((await c.get('/admin/users')).status).toBe(403);
    await enableMfa(c);
    expect((await c.get('/me')).json().adminMfaPending).toBe(false);
    expect((await c.get('/admin/users')).status).toBe(200);
  });

  it('an administrator can reset a lost second factor', async () => {
    const u = await activeUser();
    await enableMfa(await clientFor(built, cookieFrom((await localLogin(u.email)).headers)));
    expect((await localLogin(u.email)).json().mfaRequired).toBe(true);
    expect((await admin.post(`/admin/users/${u.id}/mfa-reset`)).status).toBe(200);
    expect((await localLogin(u.email)).json().mfaRequired).toBe(false);
  });
});

describe('local accounts: founder protection', () => {
  it('no administrator can issue a password link, reset 2FA or unlock the founder', async () => {
    const founderId = await userId(built, 'founder');
    for (const action of ['local-access', 'mfa-reset', 'local-unlock']) {
      const r = await admin.post(`/admin/users/${founderId}/${action}`);
      expect(r.status, action).toBe(403);
      expect(r.json().error.code).toBe('founder_protected');
    }
  });

  it('the database refuses password links for the founder outside the recovery procedure', async () => {
    const founderId = await userId(built, 'founder');
    await expect(
      built.deps.db.insert(localAuthTokens).values({ id: `x${Date.now()}`, userId: founderId, purpose: 'reset', expiresAt: new Date(Date.now() + 60_000) }),
    ).rejects.toThrow();
    await expect(built.deps.db.execute(sql`INSERT INTO local_credentials (user_id) VALUES (${founderId})`)).rejects.toThrow();
  });

  it('demo accounts cannot receive local credentials', async () => {
    const demo = await userId(built, 'bradesco1');
    expect((await admin.post(`/admin/users/${demo}/local-access`)).status).toBe(400);
  });
});

describe('local accounts: configuration', () => {
  it('is off by default', async () => {
    const off = await createTestApp();
    const r = await off.app.inject({ method: 'POST', url: `${API}/auth/login`, headers: { 'x-requested-with': 'uon-connect', 'content-type': 'application/json' }, payload: { email: 'a@b.test', password: 'x' } });
    expect(r.statusCode).toBe(404);
    expect((await off.app.inject({ method: 'GET', url: `${API}/auth/providers` })).json().localEnabled).toBe(false);
    await off.app.close();
  });

  it('requires an encryption key and refuses production without any login method', () => {
    const base = { DATABASE_URL: 'postgres://x/y' };
    expect(() => loadEnv({ ...base, LOCAL_AUTH_ENABLED: 'true' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', APP_BASE_URL: 'https://uon.example' } as NodeJS.ProcessEnv)).toThrow(/Nenhum método de login/);
    expect(loadEnv({ ...base, NODE_ENV: 'production', APP_BASE_URL: 'https://uon.example', LOCAL_AUTH_ENABLED: 'true', TOKEN_ENCRYPTION_KEY: KEY } as NodeJS.ProcessEnv).localAuthEnabled).toBe(true);
  });
});
