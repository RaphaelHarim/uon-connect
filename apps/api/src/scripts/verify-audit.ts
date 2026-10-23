import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}
const { db, pool } = createDatabase(url, 1);
db.execute(sql`
  WITH ordered AS (
    SELECT e.id, e.hash, e.prev_hash, lag(e.hash) OVER (ORDER BY e.id) AS expected_prev, uon_audit_hash(e, e.prev_hash) AS recomputed
    FROM audit_events e)
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE hash IS DISTINCT FROM recomputed OR prev_hash IS DISTINCT FROM expected_prev)::int AS broken,
         min(id) FILTER (WHERE hash IS DISTINCT FROM recomputed OR prev_hash IS DISTINCT FROM expected_prev) AS first_broken
  FROM ordered`)
  .then((r) => {
    const row = r.rows[0] as { total: number; broken: number; first_broken: string | null };
    if (row.broken === 0) console.log(`Cadeia de auditoria íntegra: ${row.total} eventos verificados.`);
    else {
      console.error(`ATENÇÃO: ${row.broken} evento(s) com hash inconsistente. Primeiro: id ${row.first_broken}.`);
      process.exitCode = 2;
    }
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
