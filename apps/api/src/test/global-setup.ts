import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';
import { seedDemo } from '../db/seed/demo.js';
import { runMigrations } from '../scripts/migrate.js';

/** Recreates the test database schema from the migrations and loads the deterministic demo data. */
export default async function setup() {
  const url = process.env.DATABASE_URL!;
  if (!/_test\b|test$/.test(new URL(url).pathname)) throw new Error(`Recusado: ${url} não parece um banco de testes.`);
  const { db, pool } = createDatabase(url, 1);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await pool.end();
  await runMigrations(url);
  const second = createDatabase(url, 1);
  await seedDemo(second.db, { tickets: 60 });
  await second.pool.end();
}
