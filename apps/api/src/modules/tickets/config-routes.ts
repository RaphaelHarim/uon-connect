import {
  calendarBody,
  categoryBody,
  holidayBody,
  idParam,
  priorityBody,
  slaPolicyBody,
  statusLabelBody,
  TICKET_STATUS_KEYS,
  transitionBody,
} from '@uon/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '../../authz/context.js';
import {
  businessCalendars,
  businessHolidays,
  slaPolicies,
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
  ticketStatusTransitions,
} from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';

export function registerTicketConfigRoutes(app: App, deps: Deps) {
  const { db } = deps;
  const guard = (req: Parameters<typeof requireAuth>[0]) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'tickets.config.manage');
    return ctx;
  };
  const audit = (req: Parameters<typeof requireAuth>[0], action: string, resourceId: string, metadata?: Record<string, unknown>) =>
    recordAudit(db, { actor: req.auth, action, resourceType: 'ticket_config', resourceId, outcome: 'success', metadata, meta: reqMeta(req) });

  app.get('/admin/ticket-config', async (req) => {
    guard(req);
    const [categories, priorities, statuses, transitions, calendars, holidays, policies] = await Promise.all([
      db.select().from(ticketCategories).orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.name)),
      db.select().from(ticketPriorities).orderBy(asc(ticketPriorities.rank)),
      db.select().from(ticketStatuses).orderBy(asc(ticketStatuses.sortOrder)),
      db.select().from(ticketStatusTransitions),
      db.select().from(businessCalendars),
      db.select().from(businessHolidays).orderBy(asc(businessHolidays.date)),
      db.select().from(slaPolicies),
    ]);
    return { categories, priorities, statuses, transitions, calendars, holidays, slaPolicies: policies };
  });

  app.post('/admin/ticket-categories', { schema: { body: categoryBody } }, async (req) => {
    guard(req);
    const [row] = await db.insert(ticketCategories).values(req.body).returning();
    await audit(req, 'ticket_config.category_created', row!.id, { name: row!.name });
    return row;
  });
  app.put('/admin/ticket-categories/:id', { schema: { params: idParam, body: categoryBody } }, async (req) => {
    guard(req);
    const [row] = await db.update(ticketCategories).set(req.body).where(eq(ticketCategories.id, req.params.id)).returning();
    if (!row) throw notFound();
    await audit(req, 'ticket_config.category_updated', row.id, req.body);
    return row;
  });

  app.post('/admin/ticket-priorities', { schema: { body: priorityBody } }, async (req) => {
    guard(req);
    const [row] = await db.insert(ticketPriorities).values(req.body).returning();
    await audit(req, 'ticket_config.priority_created', row!.key, req.body);
    return row;
  });
  app.put('/admin/ticket-priorities/:key', { schema: { params: z.object({ key: z.string().max(30) }), body: priorityBody.omit({ key: true }) } }, async (req) => {
    guard(req);
    const [row] = await db.update(ticketPriorities).set(req.body).where(eq(ticketPriorities.key, req.params.key)).returning();
    if (!row) throw notFound();
    await audit(req, 'ticket_config.priority_updated', row.key, req.body);
    return row;
  });

  /** Status keys are fixed (business rules rely on them); labels, colours and order are editable. */
  app.put('/admin/ticket-statuses/:key', { schema: { params: z.object({ key: z.enum(TICKET_STATUS_KEYS) }), body: statusLabelBody } }, async (req) => {
    guard(req);
    const [row] = await db.update(ticketStatuses).set(req.body).where(eq(ticketStatuses.key, req.params.key)).returning();
    if (!row) throw notFound();
    await audit(req, 'ticket_config.status_updated', row.key, req.body);
    return row;
  });

  app.post('/admin/ticket-transitions', { schema: { body: transitionBody } }, async (req) => {
    guard(req);
    if (req.body.fromStatus === req.body.toStatus) throw badRequest('Origem e destino devem ser diferentes.');
    await db.insert(ticketStatusTransitions).values(req.body).onConflictDoUpdate({
      target: [ticketStatusTransitions.fromStatus, ticketStatusTransitions.toStatus, ticketStatusTransitions.actor],
      set: { requiresReason: req.body.requiresReason },
    });
    await audit(req, 'ticket_config.transition_saved', `${req.body.fromStatus}->${req.body.toStatus}`, req.body);
    return { ok: true };
  });
  app.delete('/admin/ticket-transitions', { schema: { body: transitionBody.pick({ fromStatus: true, toStatus: true, actor: true }) } }, async (req) => {
    guard(req);
    await db.delete(ticketStatusTransitions).where(and(
      eq(ticketStatusTransitions.fromStatus, req.body.fromStatus),
      eq(ticketStatusTransitions.toStatus, req.body.toStatus),
      eq(ticketStatusTransitions.actor, req.body.actor),
    ));
    await audit(req, 'ticket_config.transition_removed', `${req.body.fromStatus}->${req.body.toStatus}`, req.body);
    return { ok: true };
  });

  app.post('/admin/business-calendars', { schema: { body: calendarBody } }, async (req) => {
    guard(req);
    assertTimezone(req.body.timezone);
    const [row] = await db.insert(businessCalendars).values(req.body).returning();
    await audit(req, 'ticket_config.calendar_created', row!.id, { name: row!.name });
    return row;
  });
  app.put('/admin/business-calendars/:id', { schema: { params: idParam, body: calendarBody } }, async (req) => {
    guard(req);
    assertTimezone(req.body.timezone);
    const [row] = await db.update(businessCalendars).set(req.body).where(eq(businessCalendars.id, req.params.id)).returning();
    if (!row) throw notFound();
    await audit(req, 'ticket_config.calendar_updated', row.id, { name: row.name });
    return row;
  });
  app.post('/admin/business-calendars/:id/holidays', { schema: { params: idParam, body: holidayBody } }, async (req) => {
    guard(req);
    const [row] = await db.insert(businessHolidays).values({ calendarId: req.params.id, ...req.body }).returning();
    await audit(req, 'ticket_config.holiday_added', req.params.id, req.body);
    return row;
  });
  app.delete('/admin/business-holidays/:id', { schema: { params: idParam } }, async (req) => {
    guard(req);
    await db.delete(businessHolidays).where(eq(businessHolidays.id, req.params.id));
    await audit(req, 'ticket_config.holiday_removed', req.params.id);
    return { ok: true };
  });

  app.post('/admin/sla-policies', { schema: { body: slaPolicyBody } }, async (req) => {
    guard(req);
    if (req.body.resolutionMinutes < req.body.firstResponseMinutes) throw badRequest('O prazo de solução não pode ser menor que o de primeira resposta.');
    const [row] = await db.insert(slaPolicies).values(req.body).returning();
    await audit(req, 'ticket_config.sla_created', row!.id, req.body);
    return row;
  });
  app.put('/admin/sla-policies/:id', { schema: { params: idParam, body: slaPolicyBody } }, async (req) => {
    guard(req);
    const [row] = await db.update(slaPolicies).set(req.body).where(eq(slaPolicies.id, req.params.id)).returning();
    if (!row) throw notFound();
    await audit(req, 'ticket_config.sla_updated', row.id, req.body);
    return row;
  });
}

function assertTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw badRequest('Fuso horário inválido (use um identificador IANA, ex.: America/Sao_Paulo).');
  }
}
