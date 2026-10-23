import { absenceBody, idParam, presenceBody } from '@uon/shared';
import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { absenceSchedules, userPresence, users } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { toUserSummary } from '../../lib/users.js';
import { recordAudit } from '../audit/service.js';
import { broadcastPresence, canSeeAbsence, presenceForUsers, runAbsenceTransitions } from './service.js';

export function registerPresenceRoutes(app: App, deps: Deps) {
  const { db } = deps;

  app.get('/presence', { schema: { querystring: z.object({ ids: z.string().max(4000) }) } }, async (req) => {
    requireAuth(req);
    const ids = req.query.ids.split(',').filter((x) => z.uuid().safeParse(x).success).slice(0, 200);
    return [...(await presenceForUsers(deps, ids)).values()];
  });

  app.put('/me/presence', { schema: { body: presenceBody } }, async (req) => {
    const ctx = requireAuth(req);
    const { status, message, expiresAt } = req.body;
    const values = {
      manualStatus: status,
      statusMessage: message ?? null,
      manualExpiresAt: status && expiresAt ? new Date(expiresAt) : null,
    };
    await db.insert(userPresence).values({ userId: ctx.userId, ...values }).onConflictDoUpdate({ target: userPresence.userId, set: values });
    await broadcastPresence(deps, ctx.userId);
    return (await presenceForUsers(deps, [ctx.userId])).get(ctx.userId);
  });

  app.get('/me/absences', async (req) => {
    const ctx = requireAuth(req);
    const rows = await db.select().from(absenceSchedules).where(eq(absenceSchedules.userId, ctx.userId)).orderBy(desc(absenceSchedules.startsAt)).limit(50);
    const subIds = rows.map((r) => r.substituteUserId).filter((x): x is string => !!x);
    const subs = subIds.length ? await db.select().from(users).where(inArray(users.id, subIds)) : [];
    const byId = new Map(subs.map((s) => [s.id, toUserSummary(s)]));
    return rows.map((r) => ({ ...r, substitute: r.substituteUserId ? byId.get(r.substituteUserId) ?? null : null }));
  });

  app.post('/me/absences', { schema: { body: absenceBody } }, async (req) => {
    const ctx = requireAuth(req);
    const b = req.body;
    if (new Date(b.endsAt) <= new Date()) throw badRequest('O término da ausência já passou.');
    if (b.substituteUserId) {
      if (b.substituteUserId === ctx.userId) throw badRequest('Você não pode ser seu próprio substituto.');
      const [s] = await db.select({ status: users.status }).from(users).where(eq(users.id, b.substituteUserId));
      if (!s || s.status !== 'active') throw badRequest('Contato substituto inválido ou inativo.');
    }
    const overlapping = await db
      .select({ id: absenceSchedules.id })
      .from(absenceSchedules)
      .where(
        and(
          eq(absenceSchedules.userId, ctx.userId),
          inArray(absenceSchedules.status, ['scheduled', 'active']),
          gt(absenceSchedules.endsAt, new Date(b.startsAt)),
          lt(absenceSchedules.startsAt, new Date(b.endsAt)),
        ),
      )
      .limit(1);
    const overlaps = overlapping.length > 0;
    if (overlaps) throw conflict('Já existe uma ausência programada nesse período.');
    const [row] = await db
      .insert(absenceSchedules)
      .values({
        userId: ctx.userId,
        startsAt: new Date(b.startsAt),
        endsAt: new Date(b.endsAt),
        message: b.message ?? null,
        substituteUserId: b.substituteUserId ?? null,
        visibility: b.visibility,
      })
      .returning();
    await recordAudit(db, { actor: ctx, action: 'absence.created', resourceType: 'absence', resourceId: row!.id, outcome: 'success', meta: reqMeta(req) });
    await runAbsenceTransitions(deps);
    const [fresh] = await db.select().from(absenceSchedules).where(eq(absenceSchedules.id, row!.id));
    return fresh;
  });

  async function ownAbsence(userId: string, id: string) {
    const [row] = await db.select().from(absenceSchedules).where(and(eq(absenceSchedules.id, id), eq(absenceSchedules.userId, userId)));
    if (!row) throw notFound('Ausência não encontrada.');
    return row;
  }

  /** Starts a scheduled absence now. */
  app.post('/me/absences/:id/activate', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    const row = await ownAbsence(ctx.userId, req.params.id);
    if (row.status !== 'scheduled') throw conflict('Somente ausências programadas podem ser ativadas.');
    await db.update(absenceSchedules).set({ startsAt: new Date() }).where(eq(absenceSchedules.id, row.id));
    await runAbsenceTransitions(deps);
    return { ok: true };
  });

  /** Ends an active absence (or cancels a scheduled one). */
  app.post('/me/absences/:id/end', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    const row = await ownAbsence(ctx.userId, req.params.id);
    if (row.status === 'active') {
      await db.update(absenceSchedules).set({ status: 'ended', endsAt: new Date(Math.max(Date.now(), row.startsAt.getTime() + 1000)) }).where(eq(absenceSchedules.id, row.id));
    } else if (row.status === 'scheduled') {
      await db.update(absenceSchedules).set({ status: 'cancelled' }).where(eq(absenceSchedules.id, row.id));
    } else {
      throw conflict('Esta ausência já foi encerrada.');
    }
    await broadcastPresence(deps, ctx.userId);
    return { ok: true };
  });

  /** Current or next absence of a colleague, filtered by the visibility chosen by its owner. */
  app.get('/users/:id/absence', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    const rows = await db
      .select()
      .from(absenceSchedules)
      .where(and(eq(absenceSchedules.userId, req.params.id), inArray(absenceSchedules.status, ['active', 'scheduled'])))
      .orderBy(asc(absenceSchedules.startsAt))
      .limit(1);
    const a = rows[0];
    if (!a) return { absence: null };
    // Status "away" is public through presence; message and substitute depend on visibility.
    if (!(await canSeeAbsence(deps, ctx, a.userId, a.visibility))) {
      return { absence: { status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, restricted: true } };
    }
    let substitute = null;
    if (a.substituteUserId) {
      const [s] = await db.select().from(users).where(eq(users.id, a.substituteUserId));
      substitute = s ? toUserSummary(s) : null;
    }
    return { absence: { status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, message: a.message, substitute, restricted: false } };
  });
}
