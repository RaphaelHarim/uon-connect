import {
  createTicketBody,
  idParam,
  ticketAssignBody,
  ticketCommentBody,
  ticketListQuery,
  ticketPriorityBody,
  ticketStatusBody,
  ticketWatcherBody,
} from '@uon/shared';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { clients, ticketAttachments, ticketCategories, ticketPriorities, ticketStatuses } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { conflict } from '../../lib/errors.js';
import { reqMeta, requireAuth, sendCsv } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';
import { fileView, saveUpload } from '../files/service.js';
import {
  addComment,
  addWatcher,
  allowedDestinations,
  assignableUsers,
  assignTicket,
  changePriority,
  changeStatus,
  createTicket,
  listTickets,
  loadTicketFor,
  removeWatcher,
  ticketDetail,
} from './service.js';
import { handlesQueue } from './policy.js';

const EXPORT_LIMIT = 5000;

export function registerTicketRoutes(app: App, deps: Deps) {
  const { db } = deps;

  /** Everything the "new ticket" form needs, filtered for the current user. */
  app.get('/tickets/form-options', async (req) => {
    const ctx = requireAuth(req);
    const [categories, priorities, cls, destinations] = await Promise.all([
      db.select().from(ticketCategories).where(eq(ticketCategories.active, true)).orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.name)),
      db.select().from(ticketPriorities).where(eq(ticketPriorities.active, true)).orderBy(asc(ticketPriorities.rank)),
      db.select().from(clients).where(eq(clients.active, true)).orderBy(asc(clients.name)),
      allowedDestinations(deps, ctx),
    ]);
    return { categories, priorities, clients: cls, destinations };
  });

  app.get('/tickets/statuses', async (req) => {
    requireAuth(req);
    return db.select().from(ticketStatuses).orderBy(asc(ticketStatuses.sortOrder));
  });

  app.get('/tickets', { schema: { querystring: ticketListQuery } }, async (req) => {
    const ctx = requireAuth(req);
    const r = await listTickets(deps, ctx, req.query);
    return { ...r, page: req.query.page, pageSize: req.query.pageSize };
  });

  app.get('/tickets/export', { schema: { querystring: ticketListQuery } }, async (req, reply) => {
    const ctx = requireAuth(req);
    const r = await listTickets(deps, ctx, req.query, { limit: EXPORT_LIMIT, offset: 0 });
    await recordAudit(db, { actor: ctx, action: 'tickets.exported', resourceType: 'ticket', outcome: 'success', metadata: { count: r.items.length, filters: { ...req.query, q: req.query.q ? '[termo]' : undefined } }, meta: reqMeta(req) });
    const fmt = (d: Date | null) => (d ? d.toISOString() : '');
    return sendCsv(
      reply,
      `chamados-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Protocolo', 'Título', 'Status', 'Prioridade', 'Categoria', 'Departamento', 'Equipe', 'Cliente', 'Solicitante', 'Responsável', 'SLA', 'Criado em', 'Atualizado em'],
      r.items.map((t) => [
        t.protocol,
        t.confidential ? '[confidencial]' : t.title,
        t.status.label,
        t.priority.label,
        t.category,
        t.handlingDepartment,
        t.handlingTeam,
        t.client,
        t.requester.name,
        t.assignee?.name ?? '',
        t.sla,
        fmt(t.createdAt),
        fmt(t.updatedAt),
      ]),
    );
  });

  app.post('/tickets', { schema: { body: createTicketBody } }, async (req) => {
    const ctx = requireAuth(req);
    const t = await createTicket(deps, ctx, req.body, reqMeta(req));
    return { id: t.id, protocol: t.protocol };
  });

  app.get('/tickets/:id', { schema: { params: idParam } }, async (req) => ticketDetail(deps, requireAuth(req), req.params.id));

  app.post('/tickets/:id/comments', { schema: { params: idParam, body: ticketCommentBody } }, async (req) => {
    const c = await addComment(deps, requireAuth(req), req.params.id, req.body, reqMeta(req));
    return { id: c.id };
  });

  app.post('/tickets/:id/status', { schema: { params: idParam, body: ticketStatusBody } }, async (req) => {
    await changeStatus(deps, requireAuth(req), req.params.id, req.body.status, req.body.reason, reqMeta(req));
    return { ok: true };
  });

  app.post('/tickets/:id/assign', { schema: { params: idParam, body: ticketAssignBody } }, async (req) => {
    await assignTicket(deps, requireAuth(req), req.params.id, req.body.assigneeId, reqMeta(req));
    return { ok: true };
  });

  app.get('/tickets/:id/assignable', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    const { ticket } = await loadTicketFor(deps, ctx, req.params.id);
    if (!handlesQueue(ctx, ticket)) return [];
    return assignableUsers(deps, ticket);
  });

  app.post('/tickets/:id/priority', { schema: { params: idParam, body: ticketPriorityBody } }, async (req) => {
    await changePriority(deps, requireAuth(req), req.params.id, req.body.priority, reqMeta(req));
    return { ok: true };
  });

  app.post('/tickets/:id/watchers', { schema: { params: idParam, body: ticketWatcherBody } }, async (req) => {
    await addWatcher(deps, requireAuth(req), req.params.id, req.body.userId, reqMeta(req));
    return { ok: true };
  });

  app.delete('/tickets/:id/watchers/:userId', { schema: { params: idParam.extend({ userId: z.uuid() }) } }, async (req) => {
    await removeWatcher(deps, requireAuth(req), req.params.id, req.params.userId, reqMeta(req));
    return { ok: true };
  });

  /** Upload an attachment to a ticket the caller can see. It can then be referenced by a comment. */
  app.post('/tickets/:id/attachments', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    const { ticket } = await loadTicketFor(deps, ctx, req.params.id);
    if (['closed', 'cancelled'].includes(ticket.statusKey)) throw conflict('Chamados encerrados não recebem anexos.');
    const file = await saveUpload(deps, req, { purpose: 'ticket', contextId: ticket.id, uploaderId: ctx.userId });
    await db.insert(ticketAttachments).values({ fileId: file.id, ticketId: ticket.id });
    await recordAudit(db, { actor: ctx, action: 'ticket.attachment_uploaded', resourceType: 'ticket', resourceId: ticket.id, outcome: 'success', metadata: { fileId: file.id, size: file.sizeBytes, mime: file.mimeType }, meta: reqMeta(req) });
    return fileView(file);
  });
}
