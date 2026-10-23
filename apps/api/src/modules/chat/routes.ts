import {
  addMembersBody,
  createDirectBody,
  createGroupBody,
  editMessageBody,
  idParam,
  memberRoleBody,
  memberSettingsBody,
  messageSearchQuery,
  messagesQuery,
  reactionBody,
  sendMessageBody,
  updateGroupBody,
} from '@uon/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { conversationMembers, conversations } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { forbidden } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';
import { fileView, saveUpload } from '../files/service.js';
import {
  activeMemberIds,
  addMembers,
  conversationDetail,
  conversationFiles,
  createGroup,
  deleteMessage,
  editMessage,
  listConversations,
  listMessages,
  markRead,
  openDirect,
  removeMember,
  requireMember,
  searchMessages,
  sendMessage,
  setMemberRole,
  toggleReaction,
} from './service.js';

export function registerChatRoutes(app: App, deps: Deps) {
  const { db } = deps;

  app.get('/conversations', async (req) => listConversations(deps, requireAuth(req)));

  app.post('/conversations/direct', { schema: { body: createDirectBody } }, async (req) => {
    const c = await openDirect(deps, requireAuth(req), req.body.userId);
    return { id: c.id };
  });

  app.post('/conversations/groups', { schema: { body: createGroupBody } }, async (req) => {
    const c = await createGroup(deps, requireAuth(req), req.body, reqMeta(req));
    return { id: c.id };
  });

  app.get('/conversations/:id', { schema: { params: idParam } }, async (req) => conversationDetail(deps, requireAuth(req), req.params.id));

  app.patch('/conversations/:id', { schema: { params: idParam, body: updateGroupBody } }, async (req) => {
    const ctx = requireAuth(req);
    const { conv, member } = await requireMember(deps, ctx, req.params.id);
    if (conv.type !== 'group' || member.role !== 'admin') throw forbidden('Somente administradores do grupo podem editá-lo.');
    await db.update(conversations).set(req.body).where(eq(conversations.id, conv.id));
    await recordAudit(db, { actor: ctx, action: 'chat.group_updated', resourceType: 'conversation', resourceId: conv.id, outcome: 'success', metadata: { fields: Object.keys(req.body) }, meta: reqMeta(req) });
    deps.realtime.toUsers(await activeMemberIds(deps, conv.id), 'conversation:updated', { id: conv.id });
    return { ok: true };
  });

  app.post('/conversations/:id/members', { schema: { params: idParam, body: addMembersBody } }, async (req) =>
    addMembers(deps, requireAuth(req), req.params.id, req.body.userIds, reqMeta(req)),
  );

  app.delete('/conversations/:id/members/:userId', { schema: { params: idParam.extend({ userId: z.uuid() }) } }, async (req) => {
    await removeMember(deps, requireAuth(req), req.params.id, req.params.userId, reqMeta(req));
    return { ok: true };
  });

  app.put('/conversations/:id/members/:userId/role', { schema: { params: idParam.extend({ userId: z.uuid() }), body: memberRoleBody } }, async (req) => {
    await setMemberRole(deps, requireAuth(req), req.params.id, req.params.userId, req.body.role, reqMeta(req));
    return { ok: true };
  });

  app.put('/conversations/:id/settings', { schema: { params: idParam, body: memberSettingsBody } }, async (req) => {
    const ctx = requireAuth(req);
    await requireMember(deps, ctx, req.params.id);
    await db.update(conversationMembers).set({ notifications: req.body.notifications })
      .where(and(eq(conversationMembers.conversationId, req.params.id), eq(conversationMembers.userId, ctx.userId)));
    return { ok: true };
  });

  app.get('/conversations/:id/messages', { schema: { params: idParam, querystring: messagesQuery } }, async (req) =>
    listMessages(deps, requireAuth(req), req.params.id, req.query.before, req.query.limit),
  );

  app.post('/conversations/:id/messages', { schema: { params: idParam, body: sendMessageBody }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) =>
    sendMessage(deps, requireAuth(req), req.params.id, req.body),
  );

  app.post('/conversations/:id/read', { schema: { params: idParam } }, async (req) => {
    await markRead(deps, requireAuth(req), req.params.id);
    return { ok: true };
  });

  app.get('/conversations/:id/files', { schema: { params: idParam } }, async (req) => conversationFiles(deps, requireAuth(req), req.params.id));

  app.post('/conversations/:id/files', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    await requireMember(deps, ctx, req.params.id);
    const file = await saveUpload(deps, req, { purpose: 'message', contextId: req.params.id, uploaderId: ctx.userId });
    return fileView(file);
  });

  app.patch('/messages/:id', { schema: { params: idParam, body: editMessageBody } }, async (req) => editMessage(deps, requireAuth(req), req.params.id, req.body.body));

  app.delete('/messages/:id', { schema: { params: idParam } }, async (req) => {
    await deleteMessage(deps, requireAuth(req), req.params.id, reqMeta(req));
    return { ok: true };
  });

  app.post('/messages/:id/reactions', { schema: { params: idParam, body: reactionBody } }, async (req) => toggleReaction(deps, requireAuth(req), req.params.id, req.body.emoji));

  app.get('/messages/search', { schema: { querystring: messageSearchQuery } }, async (req) =>
    searchMessages(deps, requireAuth(req), req.query.q, req.query.conversationId, req.query.limit),
  );
}
