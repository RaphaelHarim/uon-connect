import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../app.js';
import { ConfigError, loadEnv } from '../config/env.js';
import { verifyEntraClaims } from '../auth/entra.js';
import { createTestApp, emailOf, login, TEST_PASSWORD, testEnv } from './helpers.js';

let built: BuiltApp;
beforeAll(async () => {
  built = await createTestApp();
});
afterAll(async () => {
  await built.app.close();
});

const PRIVATE_ROUTES = ['/me', '/tickets', '/conversations', '/notifications', '/dashboards/personal', '/admin/users', '/admin/audit', '/directory', '/search?q=ab'];

describe('authentication', () => {
  it('rejects unauthenticated access to every private resource', async () => {
    for (const url of PRIVATE_ROUTES) {
      const r = await built.app.inject({ method: 'GET', url: `/api/v1${url}` });
      expect(r.statusCode, url).toBe(401);
    }
  });

  it('logs in demo users with the test password only', async () => {
    const bad = await built.app.inject({
      method: 'POST', url: '/api/v1/auth/dev-login',
      headers: { 'x-requested-with': 'uon-connect', 'content-type': 'application/json' },
      payload: { email: emailOf('bradesco1'), password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
    const c = await login(built, 'bradesco1');
    expect((await c.get('/me')).status).toBe(200);
  });

  it('records failed logins in the audit log without the password', async () => {
    const admin = await login(built, 'auditor');
    const r = await admin.get('/admin/audit?action=auth.dev_login&outcome=failure');
    expect(r.status).toBe(200);
    const items = r.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(JSON.stringify(items)).not.toContain('wrong-password');
  });

  it('requires the CSRF token and the custom header on state-changing requests', async () => {
    const c = await login(built, 'bradesco1');
    const noHeader = await built.app.inject({ method: 'POST', url: '/api/v1/notifications/read-all', headers: { cookie: c.cookie } });
    expect(noHeader.statusCode).toBe(403);
    const wrongToken = await built.app.inject({ method: 'POST', url: '/api/v1/notifications/read-all', headers: { cookie: c.cookie, 'x-requested-with': 'uon-connect', 'x-csrf-token': 'nope' } });
    expect(wrongToken.statusCode).toBe(403);
    expect((await c.post('/notifications/read-all')).status).toBe(200);
  });

  it('revokes the session on logout', async () => {
    const c = await login(built, 'bradesco2');
    expect((await c.post('/auth/logout')).status).toBe(200);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('rate-limits repeated login attempts', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    const attempt = () => limited.app.inject({
      method: 'POST', url: '/api/v1/auth/dev-login',
      headers: { 'x-requested-with': 'uon-connect', 'content-type': 'application/json' },
      payload: { email: emailOf('bradesco1'), password: 'wrong' },
    });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await attempt()).statusCode);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
    await limited.app.close();
  });

  it('does not expose the dev login when it is disabled', async () => {
    const off = await createTestApp({ AUTH_DEV_LOGIN_ENABLED: 'false' });
    const r = await off.app.inject({
      method: 'POST', url: '/api/v1/auth/dev-login',
      headers: { 'x-requested-with': 'uon-connect', 'content-type': 'application/json' },
      payload: { email: emailOf('bradesco1'), password: TEST_PASSWORD },
    });
    expect(r.statusCode).toBe(404);
    await off.app.close();
  });
});

describe('configuration safety', () => {
  const base = { DATABASE_URL: 'postgres://x/y', APP_BASE_URL: 'https://connect.example.com' };
  it('refuses to start in production with the development login enabled', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_DEV_LOGIN_ENABLED: 'true', DEV_LOGIN_PASSWORD: 'whatever123' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
  it('keeps the development login off when the password is missing', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'development', AUTH_DEV_LOGIN_ENABLED: 'true' } as NodeJS.ProcessEnv).devLoginEnabled).toBe(false);
  });
  it('rejects a partial Entra ID configuration', () => {
    expect(() => loadEnv({ ...base, ENTRA_TENANT_ID: 'abc' } as NodeJS.ProcessEnv)).toThrow(/incompleta/);
  });
  it('requires https in production', () => {
    expect(() => loadEnv({ ...base, APP_BASE_URL: 'http://x', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/https/);
  });
});

describe('Entra ID claim checks', () => {
  const tenant = '11111111-1111-1111-1111-111111111111';
  const env = testEnv({
    ENTRA_TENANT_ID: tenant, ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's', ENTRA_REDIRECT_URI: 'http://localhost/cb',
    ENTRA_ALLOWED_EMAIL_DOMAINS: 'uongroup.com', ENTRA_ALLOWED_GROUP_IDS: 'g-ok',
  });
  const good = { tid: tenant, oid: 'oid-1', preferred_username: 'Pessoa@UONgroup.com', groups: ['g-ok'] };
  it('accepts a valid identity and normalises the e-mail', () => {
    expect(verifyEntraClaims(good, env)).toMatchObject({ objectId: 'oid-1', email: 'pessoa@uongroup.com' });
  });
  it('rejects another tenant, missing oid, other domains and missing groups', () => {
    expect(() => verifyEntraClaims({ ...good, tid: 'other' }, env)).toThrow(/diretório/);
    expect(() => verifyEntraClaims({ ...good, oid: undefined }, env)).toThrow(/oid/);
    expect(() => verifyEntraClaims({ ...good, preferred_username: 'x@gmail.com' }, env)).toThrow(/domínio/);
    expect(() => verifyEntraClaims({ ...good, groups: ['other'] }, env)).toThrow(/grupo/);
    expect(() => verifyEntraClaims({ ...good, groups: undefined, _claim_names: { groups: 'src1' } }, env)).toThrow(/excesso/);
  });
});
