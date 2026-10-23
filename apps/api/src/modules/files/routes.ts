import { idParam } from '@uon/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../authz/context.js';
import { files, messageAttachments, messages, ticketAttachments, ticketComments } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { notFound } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';
import { membership } from '../chat/service.js';
import { loadTicketFor } from '../tickets/service.js';
import { type FileRow, streamFile } from './service.js';

/**
 * Decides, per file, whether the caller may read it — by looking at what the file is attached to.
 * Any failure is reported as 404 so file ids can't be probed.
 */
export async function canReadFile(deps: Deps, ctx: AuthContext, file: FileRow): Promise<boolean> {
  if (file.deletedAt) return false;
  if (file.purpose === 'avatar') return true;
  if (file.purpose === 'ticket') {
    const [att] = await deps.db
      .select({ ticketId: ticketAttachments.ticketId, internal: ticketComments.internal })
      .from(ticketAttachments)
      .leftJoin(ticketComments, eq(ticketComments.id, ticketAttachments.commentId))
      .where(eq(ticketAttachments.fileId, file.id));
    if (!att) return file.uploadedBy === ctx.userId;
    try {
      const { rel } = await loadTicketFor(deps, ctx, att.ticketId);
      return att.internal ? rel.canManage : rel.canView;
    } catch {
      return false;
    }
  }
  // Message files: attached → current conversation member; not yet sent → uploader only.
  const [att] = await deps.db
    .select({ conversationId: messages.conversationId, deletedAt: messages.deletedAt })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(eq(messageAttachments.fileId, file.id));
  if (!att) return file.uploadedBy === ctx.userId;
  if (att.deletedAt) return false;
  return !!(await membership(deps, att.conversationId, ctx.userId));
}

export function registerFileRoutes(app: App, deps: Deps) {
  app.get('/files/:id', { schema: { params: idParam, querystring: z.object({ inline: z.coerce.boolean().optional() }) } }, async (req, reply) => {
    const ctx = requireAuth(req);
    const [file] = await deps.db.select().from(files).where(eq(files.id, req.params.id));
    if (!file || !(await canReadFile(deps, ctx, file))) {
      await recordAudit(deps.db, { actor: ctx, action: 'file.download', resourceType: 'file', resourceId: req.params.id, outcome: 'denied', meta: reqMeta(req) });
      throw notFound('Arquivo não encontrado.');
    }
    if (file.purpose !== 'avatar') {
      await recordAudit(deps.db, { actor: ctx, action: 'file.download', resourceType: 'file', resourceId: file.id, outcome: 'success', metadata: { purpose: file.purpose }, meta: reqMeta(req) });
    }
    return streamFile(deps, reply, file, { inline: req.query.inline });
  });
}
