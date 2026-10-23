import { and, eq, lt, sql } from 'drizzle-orm';
import { purgeExpiredSessions } from '../auth/sessions.js';
import { authFlows, notifications, tickets, ticketEvents, users } from '../db/schema/index.js';
import type { Deps } from '../deps.js';
import { runAbsenceTransitions } from '../modules/presence/service.js';
import { getSetting } from '../modules/settings/service.js';
import { notify } from '../modules/notifications/service.js';
import type { Mailer } from './mailer.js';
import { claimJob, completeJob, failJob, releaseStaleJobs } from './queue.js';

const SCHEDULER_LOCK = 7243002;

/** Background work: the job queue worker and the periodic scheduler (one instance at a time via advisory lock). */
export class BackgroundRunner {
  private timers: NodeJS.Timeout[] = [];
  private stopping = false;
  private busy = Promise.resolve();

  constructor(private readonly deps: Deps, private readonly mailer: Mailer) {}

  start() {
    this.timers.push(setInterval(() => this.enqueue(() => this.drainQueue()), 3_000));
    this.timers.push(setInterval(() => this.enqueue(() => this.tick()), 30_000));
    this.enqueue(() => this.tick());
  }

  private enqueue(fn: () => Promise<void>) {
    if (this.stopping) return;
    this.busy = this.busy.then(fn).catch((err) => this.deps.log.error({ err }, 'background task failed'));
  }

  async stop() {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    await this.busy;
  }

  async drainQueue(max = 20) {
    const { db, log } = this.deps;
    for (let i = 0; i < max && !this.stopping; i++) {
      const job = await claimJob(db);
      if (!job) return;
      try {
        await this.handle(job.type, job.payload);
        await completeJob(db, job.id);
      } catch (err) {
        log.warn({ err, jobId: job.id, type: job.type }, 'job failed');
        await failJob(db, job, (err as Error).message);
      }
    }
  }

  private async handle(type: string, payload: Record<string, unknown>) {
    if (type === 'email.notification') {
      const { db, env } = this.deps;
      const [n] = await db
        .select({ title: notifications.title, link: notifications.link, email: users.email, name: users.displayName, status: users.status })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(eq(notifications.id, String(payload.notificationId)));
      if (!n || n.status !== 'active') return;
      const url = n.link ? new URL(n.link, env.APP_BASE_URL).href : env.APP_BASE_URL;
      // Only the title (written to be free of confidential content) and a link — never message or ticket bodies.
      await this.mailer.send({
        to: n.email,
        subject: `UON CONNECT — ${n.title}`,
        text: `Olá, ${n.name}.\n\n${n.title}.\n\nAcesse: ${url}\n\nVocê recebe este e-mail conforme suas preferências de notificação no UON CONNECT.`,
      });
      return;
    }
    throw new Error(`Tipo de tarefa desconhecido: ${type}`);
  }

  /** Periodic maintenance; safe to run on several instances (only one wins the lock). */
  async tick() {
    const { db, pool } = this.deps;
    const client = await pool.connect();
    try {
      const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [SCHEDULER_LOCK]);
      if (!r.rows[0]?.ok) return;
      try {
        await runAbsenceTransitions(this.deps);
        await this.autoCloseResolved();
        await this.slaWarnings();
        await releaseStaleJobs(db);
        await db.delete(authFlows).where(lt(authFlows.expiresAt, new Date()));
        if (new Date().getMinutes() === 0) await purgeExpiredSessions(db);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK]);
      }
    } finally {
      client.release();
    }
  }

  private async autoCloseResolved() {
    const days = await getSetting(this.deps.db, 'ticketAutoCloseResolvedDays');
    if (!days) return;
    const limit = new Date(Date.now() - days * 86_400_000);
    const closed = await this.deps.db
      .update(tickets)
      .set({ statusKey: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tickets.statusKey, 'resolved'), lt(tickets.resolvedAt, limit)))
      .returning({ id: tickets.id });
    for (const t of closed) {
      await this.deps.db.insert(ticketEvents).values({ ticketId: t.id, type: 'status_changed', fromValue: 'resolved', toValue: 'closed', data: { automatic: true, reason: `Encerrado automaticamente após ${days} dias resolvido` } });
    }
  }

  /** Warns the assignee once when less than an hour of SLA remains. */
  private async slaWarnings() {
    const res = await this.deps.db.execute(sql`
      SELECT t.id, t.protocol, t.assignee_id FROM tickets t
      WHERE t.status_key IN ('open','triage','in_progress','waiting_third_party')
        AND t.assignee_id IS NOT NULL AND t.resolution_due_at IS NOT NULL
        AND t.resolution_due_at BETWEEN now() AND now() + interval '1 hour'
        AND NOT EXISTS (SELECT 1 FROM ticket_events e WHERE e.ticket_id = t.id AND e.type = 'sla_warning')
      LIMIT 50`);
    for (const t of res.rows as { id: string; protocol: string; assignee_id: string }[]) {
      await this.deps.db.insert(ticketEvents).values({ ticketId: t.id, type: 'sla_warning' });
      await notify(this.deps, { userIds: [t.assignee_id], category: 'deadline', title: `O prazo de SLA do chamado ${t.protocol} vence em menos de 1 hora`, link: `/chamados/${t.id}`, resourceType: 'ticket', resourceId: t.id });
    }
  }
}
