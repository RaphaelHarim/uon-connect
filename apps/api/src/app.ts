import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { API_PREFIX } from '@uon/shared';
import Fastify, { type FastifyError } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { EntraProvider } from './auth/entra.js';
import { resolveSession, sessionCookieName } from './auth/sessions.js';
import { loadAuthContext } from './authz/context.js';
import type { Env } from './config/env.js';
import { createDatabase } from './db/client.js';
import type { Deps } from './deps.js';
import { createMailer, type Mailer } from './jobs/mailer.js';
import { randomToken } from './lib/crypto.js';
import { AppError, mapDatabaseError } from './lib/errors.js';
import type { App } from './lib/types.js';
import { registerRoutes } from './routes.js';
import { Realtime } from './realtime/bus.js';
import { LocalDiskStorage } from './storage/index.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface BuiltApp {
  app: App;
  deps: Deps;
  mailer: Mailer;
  entra: EntraProvider;
}

export async function buildApp(env: Env): Promise<BuiltApp> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
          '*.accessToken',
          '*.refreshToken',
        ],
        censor: '[redacted]',
      },
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomToken(12);
    },
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const { db, pool } = createDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const storage = new LocalDiskStorage(env.storageDir);
  const realtime = new Realtime();
  const deps: Deps = { env, db, pool, log: app.log, realtime, storage };
  const mailer = createMailer(env);
  const entra = new EntraProvider(env);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://login.microsoftonline.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: env.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: env.cookieSecure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  // Permissions-Policy: only this origin may use camera/microphone (video calls).
  app.addHook('onSend', async (_req, reply) => {
    reply.header('permissions-policy', 'camera=(self), microphone=(self), geolocation=(), display-capture=(self)');
  });

  if (env.CORS_ORIGINS.length > 0) {
    await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  }
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === 'test' ? 10_000 : 600,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/health'),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Muitas requisições. Tente novamente em ${Math.ceil(ctx.ttl / 1000)}s.` },
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_FILE_MB * 1024 * 1024, files: 1, fields: 10, parts: 12 },
  });

  if (env.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: { title: 'UON CONNECT API', version: '0.1.0', description: 'API interna da plataforma UON CONNECT.' },
        components: {
          securitySchemes: {
            session: { type: 'apiKey', in: 'cookie', name: 'uon_session' },
            csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
          },
        },
        security: [{ session: [], csrf: [] }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  app.decorateRequest('auth', null);

  // Authentication + CSRF. Runs for every API request.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith(API_PREFIX)) return;
    const token = req.cookies[sessionCookieName(env)];
    if (token) {
      const session = await resolveSession(db, env, token);
      if (session) req.auth = await loadAuthContext(db, session.userId, session);
    }
    if (MUTATING.has(req.method)) {
      // A custom header can't be sent cross-site without a CORS preflight, which we don't allow.
      if (req.headers['x-requested-with'] !== 'uon-connect') {
        throw new AppError(403, 'csrf', 'Requisição recusada (cabeçalho de origem ausente).');
      }
      if (req.auth && req.headers['x-csrf-token'] !== req.auth.csrfToken) {
        throw new AppError(403, 'csrf', 'Token CSRF inválido. Recarregue a página.');
      }
    }
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const correlationId = String(req.id);
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err }, err.message);
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details, correlationId } });
    }
    if (err.validation) {
      return reply.status(400).send({
        error: { code: 'validation_error', message: 'Dados inválidos.', details: err.validation, correlationId },
      });
    }
    if (err.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: 'Muitas requisições. Aguarde um instante.', correlationId } });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({
        error: { code: 'payload_too_large', message: `Arquivo maior que o limite de ${env.UPLOAD_MAX_FILE_MB} MB.`, correlationId },
      });
    }
    const mapped = mapDatabaseError(err);
    if (mapped) {
      return reply.status(mapped.status).send({ error: { code: mapped.code, message: mapped.message, correlationId } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: 'Requisição inválida.', correlationId } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Erro interno. Informe o código de correlação ao suporte.', correlationId },
    });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      const s = await storage.health();
      if (!s.ok) return reply.status(503).send({ status: 'degraded', database: 'ok', storage: 'error' });
      return { status: 'ok', database: 'ok', storage: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable', database: 'error' });
    }
  });

  await app.register(
    async (api) => {
      registerRoutes(api as App, deps, { mailer, entra });
      api.setNotFoundHandler((req, reply) =>
        reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.', correlationId: String(req.id) } }),
      );
    },
    { prefix: API_PREFIX },
  );

  // Production: the API also serves the built web client (same origin → simple cookies, no CORS).
  const webDir = env.WEB_DIST_DIR ? path.resolve(env.WEB_DIST_DIR) : null;
  if (webDir && existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      index: false,
      setHeaders: (res, filePath) => {
        const value = filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
        (res as unknown as { header: (k: string, v: string) => void }).header('cache-control', value);
      },
    });
    app.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io')) {
        return reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
      }
      const rel = decodeURIComponent(req.url.split('?')[0] ?? '/').replace(/^\/+/, '');
      if (rel && !rel.includes('..') && existsSync(path.join(webDir, rel)) && !rel.endsWith('/')) {
        return reply.sendFile(rel);
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return { app: app as unknown as App, deps, mailer, entra };
}
