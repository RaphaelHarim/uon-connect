import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../db/client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from source (src/scripts) and from the bundle (dist/).
export const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((d) => existsSync(path.join(d, 'meta/_journal.json')))!;

export async function runMigrations(url: string) {
  const { db, pool } = createDatabase(url, 1);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definido.');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrações aplicadas.'))
    .catch((err) => {
      console.error('Falha ao aplicar migrações:', err);
      process.exit(1);
    });
}
