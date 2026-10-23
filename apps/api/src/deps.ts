import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';
import type { Realtime } from './realtime/bus.js';
import type { Storage } from './storage/index.js';

/** Long-lived dependencies shared by routes, services, the socket server and background jobs. */
export interface Deps {
  env: Env;
  db: Database;
  pool: pg.Pool;
  log: FastifyBaseLogger;
  realtime: Realtime;
  storage: Storage;
}
