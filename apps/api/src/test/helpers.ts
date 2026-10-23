import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { buildApp, type BuiltApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { users } from '../db/schema/index.js';
import { DEMO_PEOPLE, type DemoKey, demoEmail } from '../db/seed/demo.js';

export const TEST_PASSWORD = 'test-password-123';

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_DEV_LOGIN_ENABLED: 'true',
    DEV_LOGIN_PASSWORD: TEST_PASSWORD,
    LOG_LEVEL: 'silent',
    STORAGE_LOCAL_DIR: mkdtempSync(path.join(os.tmpdir(), 'uon-files-')),
    APP_BASE_URL: 'http://localhost:5173',
    JOBS_ENABLED: 'false',
    AUTH_RATE_LIMIT_PER_MINUTE: '5000',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<BuiltApp> {
  const built = await buildApp(testEnv(overrides));
  await built.app.ready();
  return built;
}

export const emailOf = (key: DemoKey) => demoEmail(DEMO_PEOPLE[key].name);

export async function userId(built: BuiltApp, key: DemoKey) {
  const [u] = await built.deps.db.select({ id: users.id }).from(users).where(eq(users.email, emailOf(key)));
  return u!.id;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Client {
  userId: string;
  csrf: string;
  cookie: string;
  req: (method: Method, url: string, body?: unknown, extraHeaders?: Record<string, string>) => Promise<{ status: number; json: () => any; body: string; headers: Record<string, unknown> }>;
  get: (url: string) => ReturnType<Client['req']>;
  post: (url: string, body?: unknown) => ReturnType<Client['req']>;
  put: (url: string, body?: unknown) => ReturnType<Client['req']>;
  patch: (url: string, body?: unknown) => ReturnType<Client['req']>;
  del: (url: string, body?: unknown) => ReturnType<Client['req']>;
  upload: (url: string, filename: string, content: Buffer, mime: string) => ReturnType<Client['req']>;
}

const API = '/api/v1';

export async function login(built: BuiltApp, who: DemoKey | string): Promise<Client> {
  const email = who.includes('@') ? who : emailOf(who as DemoKey);
  const res = await built.app.inject({
    method: 'POST',
    url: `${API}/auth/dev-login`,
    headers: { 'x-requested-with': 'uon-connect', 'content-type': 'application/json' },
    payload: { email, password: TEST_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  return clientFor(built, cookieFrom(res.headers));
}

export const cookieFrom = (headers: Record<string, unknown>) => {
  const setCookie = headers['set-cookie'] as string | string[];
  return (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
};

/** Builds a client for an existing session cookie. */
export async function clientFor(built: BuiltApp, cookie: string): Promise<Client> {
  const me = await built.app.inject({ method: 'GET', url: `${API}/me`, headers: { cookie } });
  const meJson = me.json();
  const csrf = meJson.csrfToken as string;

  const req: Client['req'] = async (method, url, body, extraHeaders = {}) => {
    const r = await built.app.inject({
      method,
      url: `${API}${url}`,
      headers: {
        cookie,
        'x-requested-with': 'uon-connect',
        'x-csrf-token': csrf,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...extraHeaders,
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.statusCode, json: () => r.json(), body: r.body, headers: r.headers };
  };
  return {
    userId: meJson.user.id,
    csrf,
    cookie,
    req,
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b ?? {}),
    put: (u, b) => req('PUT', u, b ?? {}),
    patch: (u, b) => req('PATCH', u, b ?? {}),
    del: (u, b) => req('DELETE', u, b),
    upload: async (url, filename, content, mime) => {
      const boundary = `----uon${Date.now()}`;
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const r = await built.app.inject({
        method: 'POST',
        url: `${API}${url}`,
        headers: { cookie, 'x-requested-with': 'uon-connect', 'x-csrf-token': csrf, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      return { status: r.statusCode, json: () => r.json(), body: r.body, headers: r.headers };
    },
  };
}

/** Minimal valid files for upload tests. */
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
export const PDF_MIN = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
