import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
/** Either the root database handle or an open transaction. */
export type Tx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDatabase(url: string, max = 10) {
  const pool = new pg.Pool({ connectionString: url, max, application_name: 'uon-connect' });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { pool, db };
}

export { schema };
