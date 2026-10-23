import { sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { jobs } from '../db/schema/index.js';

export type JobType = 'email.notification';

export async function enqueueJob(db: Tx, type: JobType, payload: Record<string, unknown>, runAt?: Date) {
  await db.insert(jobs).values({ type, payload, runAt: runAt ?? new Date() });
}

export interface ClaimedJob {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** Claims one due job. SKIP LOCKED lets several API instances share the queue safely. */
export async function claimJob(db: Tx): Promise<ClaimedJob | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts`);
  const row = res.rows[0] as
    | { id: string | number; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }
    | undefined;
  if (!row) return null;
  return { id: Number(row.id), type: row.type, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
}

export async function completeJob(db: Tx, id: number) {
  await db.execute(sql`UPDATE jobs SET status = 'done', finished_at = now(), locked_at = NULL WHERE id = ${id}`);
}

export async function failJob(db: Tx, job: ClaimedJob, error: string) {
  const final = job.attempts >= job.maxAttempts;
  const backoffSeconds = Math.min(3600, 2 ** job.attempts * 15);
  await db.execute(sql`
    UPDATE jobs SET
      status = ${final ? 'failed' : 'pending'}::job_status,
      last_error = ${error.slice(0, 1000)},
      locked_at = NULL,
      run_at = now() + make_interval(secs => ${backoffSeconds}),
      finished_at = ${final ? sql`now()` : sql`NULL`}
    WHERE id = ${job.id}`);
}

/** Jobs left "running" by a crashed process go back to the queue. */
export async function releaseStaleJobs(db: Tx) {
  await db.execute(sql`
    UPDATE jobs SET status = 'pending', locked_at = NULL
    WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`);
}
