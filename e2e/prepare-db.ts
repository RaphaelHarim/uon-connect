// Recreates the E2E database from the migrations and loads the fictitious demo data.
import { sql } from 'drizzle-orm';
import { createDatabase } from '../apps/api/src/db/client.js';
import { seedDemo } from '../apps/api/src/db/seed/demo.js';
import { runMigrations } from '../apps/api/src/scripts/migrate.js';

const url = process.env.DATABASE_URL!;
if (!url.includes('e2e')) throw new Error(`Recusado: ${url} não é o banco de E2E.`);
const a = createDatabase(url, 1);
await a.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
await a.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
await a.db.execute(sql`CREATE SCHEMA public`);
await a.pool.end();
await runMigrations(url);
const b = createDatabase(url, 1);
await seedDemo(b.db, { tickets: 80 });
await b.pool.end();
console.log('E2E database ready');
