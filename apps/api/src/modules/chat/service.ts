import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { AuthContext } from '../../authz/context.js';
import { isLeader } from '../../authz/context.js';
import {
  conversationMembers,
  conversations,
  departmentMemberships,
  files,
  messageAttachments,
  messageMentions,
  messageReactions,
  messages,
  teamMemberships,
  teams,
  users,
} from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { toUserSummary } from '../../lib/users.js';
import { type RequestMeta, recordAudit } from '../audit/service.js';
import { fileView } from '../files/service.js';
import { notify } from '../notifications/service.js';
import { presenceForUsers } from '../presence/service.js';
import { getSettings } from '../settings/service.js';

type ConversationRow = typeof conversations.$inferSelect;
type MemberRow = typeof conversationMembers.$inferSelect;

/* ------------------------------------------------------------------ contact policy */

async function departmentsOf(deps: Deps, userId: string) {
  const [d, t] = await Promise.all([
    deps.db.select({ id: departmentMemberships.departmentId }).from(departmentMemberships).where(eq(departmentMemberships.userId, userId)),
    deps.db.select({ id: teams.departmentId }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(eq(teamMemberships.userId, userId)),
  ]);
  return new Set([...d, ...t].map((x) => x.id));
}

async function isLeaderUser(deps: Deps, userId: string) {
  const [d] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(departmentMemberships).where(and(eq(departmentMemberships.userId, userId), eq(departmentMemberships.role, 'head')));
  const [t] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(teamMemberships).where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.role, 'coordinator')));
  return (d?.n ?? 0) + (t?.n ?? 0) > 0;
}

/**
 * May `ctx` open a private channel with `otherId`? Governed by the platform setting
 * `chatDirectPolicy`: "company" (any active colleague) or "department" (same department,
 * or either side is a leader).
 */
export async function canContact(deps: Deps, ctx: AuthContext, otherId: string) {
  if (otherId === ctx.userId) return false;
  const [other] = await deps.db.select({ status: users.status }).from(users).where(eq(users.id, otherId));
  if (!other || other.status !== 'active') return false;
  const { chatDirectPolicy } = await getSettings(deps.db);
  if (chatDirectPolicy === 'company') return true;
  if (isLeader(ctx)) return true;
  const theirs = await departmentsOf(deps, otherId);
  if ([...ctx.memberDepartmentIds].some((d) => theirs.has(d))) return true;
  return isLeaderUser(deps, otherId);
}

/* ------------------------------------------------------------------ membership */

export async function membership(deps: Deps, conversationId: string, userId: string): Promise<{ conv: ConversationRow; member: MemberRow } | null> {
  const [row] = await deps.db
    .select({ conv: conversations, member: conversationMembers })
    .from(conversations)
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, userId)))
    .where(and(eq(conversations.id, conversationId), isNull(conversationMembers.leftAt)))
    .limit(1);
  return row ?? null;
}

/** Throws 404 for non-members: conversations of others are invisible, including to administrators. */
export async function requireMember(deps: Deps, ctx: AuthContext, conversationId: string) {
  const m = await membership(deps, conversationId, ctx.userId);
  if (!m) throw notFound('Conversa não encontrada.');
  return m;
}

export async function activeMemberIds(deps: Deps, conversationId: string) {
  const rows = await deps.db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
  return rows.map((r) => r.userId);
}

/* ------------------------------------------------------------------ conversations */

export async function openDirect(deps: Deps, ctx: AuthContext, otherId: string) {
  if (!(await canContact(deps, ctx, otherId))) throw forbidden('A política da empresa não permite iniciar conversa com este colaborador.');
  const key = [ctx.userId, otherId].sort().join(':');
  const [existing] = await deps.db.select().from(conversations).where(eq(conversations.directKey, key));
  if (existing) {
    // Re-activate membership for both sides if someone had left (directs are never really left).
    for (const uid of [ctx.userId, otherId]) {
      await deps.db.insert(conversationMembers).values({ conversationId: existing.id, userId: uid })
        .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { leftAt: null } });
    }
    return existing;
  }
  return deps.db.transaction(async (tx) => {
    const [conv] = await tx.insert(conversations).values({ type: 'direct', createdBy: ctx.userId, directKey: key }).onConflictDoNothing().returning();
    const c = conv ?? (await tx.select().from(conversations).where(eq(conversations.directKey, key)))[0]!;
    await tx.insert(conversationMembers).values([
      { conversationId: c.id, userId: ctx.userId },
      { conversationId: c.id, userId: otherId },
    ]).onConflictDoNothing();
    return c;
  });
}

export async function createGroup(
  deps: Deps,
  ctx: AuthContext,
  input: { name: string; description?: string | null; memberIds: string[]; teamId?: string | null; allowMembersInvite: boolean },
  meta?: RequestMeta,
) {
  const { chatGroupCreation } = await getSettings(deps.db);
  if (chatGroupCreation === 'leaders' && !isLeader(ctx) && !ctx.permissions.has('org.manage')) {
    throw forbidden('Somente coordenadores e responsáveis podem criar grupos.');
  }
  const memberIds = new Set(input.memberIds.filter((id) => id !== ctx.userId));
  if (input.teamId) {
    if (!ctx.overseenTeamIds.has(input.teamId) && !ctx.permissions.has('org.manage')) {
      throw forbidden('Somente a coordenação da equipe pode criar o grupo oficial da equipe.');
    }
    const team = await deps.db.select({ userId: teamMemberships.userId }).from(teamMemberships)
      .innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(and(eq(teamMemberships.teamId, input.teamId), eq(users.status, 'active')));
    team.forEach((m) => m.userId !== ctx.userId && memberIds.add(m.userId));
  } else {
    for (const id of memberIds) {
      if (!(await canContact(deps, ctx, id))) throw forbidden('Um dos participantes não pode ser adicionado conforme a política da empresa.');
    }
  }
  const conv = await deps.db.transaction(async (tx) => {
    const [c] = await tx.insert(conversations).values({
      type: 'group',
      name: input.name,
      description: input.description ?? null,
      createdBy: ctx.userId,
      teamId: input.teamId ?? null,
      allowMembersInvite: input.allowMembersInvite,
    }).returning();
    await tx.insert(conversationMembers).values([
      { conversationId: c!.id, userId: ctx.userId, role: 'admin', addedBy: ctx.userId },
      ...[...memberIds].map((userId) => ({ conversationId: c!.id, userId, addedBy: ctx.userId })),
    ]);
    await tx.insert(messages).values({ conversationId: c!.id, kind: 'system', body: `${ctx.user.displayName} criou o grupo "${input.name}".` });
    await recordAudit(tx, { actor: ctx, action: 'chat.group_created', resourceType: 'conversation', resourceId: c!.id, outcome: 'success', metadata: { members: memberIds.size + 1, teamId: input.teamId ?? null }, meta });
    return c!;
  });
  await notify(deps, {
    userIds: memberIds,
    category: 'group_invite',
    title: `${ctx.user.displayName} adicionou você ao grupo "${input.name}"`,
    link: `/conversas/${conv.id}`,
    resourceType: 'conversation',
    resourceId: conv.id,
  });
  deps.realtime.toUsers([ctx.userId, ...memberIds], 'conversation:updated', { id: conv.id });
  return conv;
}

export async function addMembers(deps: Deps, ctx: AuthContext, conversationId: string, userIds: string[], meta?: RequestMeta) {
  const { conv, member } = await requireMember(deps, ctx, conversationId);
  if (conv.type !== 'group') throw badRequest('Conversas individuais não aceitam novos participantes. Crie um grupo.');
  if (member.role !== 'admin' && !conv.allowMembersInvite) throw forbidden('Somente administradores do grupo podem adicionar participantes.');
  const current = new Set(await activeMemberIds(deps, conversationId));
  const toAdd = [...new Set(userIds)].filter((u) => !current.has(u));
  for (const id of toAdd) {
    if (!(await canContact(deps, ctx, id))) throw forbidden('Um dos participantes não pode ser adicionado conforme a política da empresa.');
  }
  if (!toAdd.length) return { added: 0 };
  const names = await deps.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, toAdd));
  await deps.db.transaction(async (tx) => {
    for (const userId of toAdd) {
      await tx.insert(conversationMembers).values({ conversationId, userId, addedBy: ctx.userId })
        .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { leftAt: null, joinedAt: new Date(), role: 'member', addedBy: ctx.userId } });
    }
    await tx.insert(messages).values({ conversationId, kind: 'system', body: `${ctx.user.displayName} adicionou ${names.map((n) => n.name).join(', ')}.` });
    await recordAudit(tx, { actor: ctx, action: 'chat.members_added', resourceType: 'conversation', resourceId: conversationId, outcome: 'success', metadata: { userIds: toAdd }, meta });
  });
  await notify(deps, { userIds: toAdd, category: 'group_invite', title: `${ctx.user.displayName} adicionou você ao grupo "${conv.name}"`, link: `/conversas/${conversationId}`, resourceType: 'conversation', resourceId: conversationId });
  deps.realtime.toUsers([...current, ...toAdd], 'conversation:updated', { id: conversationId });
  return { added: toAdd.length };
}

export async function removeMember(deps: Deps, ctx: AuthContext, conversationId: string, userId: string, meta?: RequestMeta) {
  const { conv, member } = await requireMember(deps, ctx, conversationId);
  if (conv.type !== 'group') throw badRequest('Não é possível sair de conversas individuais.');
  const self = userId === ctx.userId;
  if (!self && member.role !== 'admin') throw forbidden('Somente administradores do grupo podem remover participantes.');
  const target = await membership(deps, conversationId, userId);
  if (!target) throw notFound('Participante não encontrado.');
  const [u] = await deps.db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
  const remaining = await activeMemberIds(deps, conversationId);
  await deps.db.transaction(async (tx) => {
    await tx.update(conversationMembers).set({ leftAt: new Date() }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    // Never leave a group without an administrator.
    if (target.member.role === 'admin') {
      const admins = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.role, 'admin'), isNull(conversationMembers.leftAt)));
      if (admins.length === 0) {
        const [oldest] = await tx.select().from(conversationMembers)
          .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)))
          .orderBy(asc(conversationMembers.joinedAt)).limit(1);
        if (oldest) await tx.update(conversationMembers).set({ role: 'admin' }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, oldest.userId)));
      }
    }
    await tx.insert(messages).values({ conversationId, kind: 'system', body: self ? `${u?.name} saiu do grupo.` : `${ctx.user.displayName} removeu ${u?.name}.` });
    await recordAudit(tx, { actor: ctx, action: self ? 'chat.left' : 'chat.member_removed', resourceType: 'conversation', resourceId: conversationId, outcome: 'success', metadata: { userId }, meta });
  });
  deps.realtime.toUsers(remaining, 'conversation:updated', { id: conversationId });
}

export async function setMemberRole(deps: Deps, ctx: AuthContext, conversationId: string, userId: string, role: 'member' | 'admin', meta?: RequestMeta) {
  const { conv, member } = await requireMember(deps, ctx, conversationId);
  if (conv.type !== 'group' || member.role !== 'admin') throw forbidden('Somente administradores do grupo podem alterar funções.');
  if (!(await membership(deps, conversationId, userId))) throw notFound('Participante não encontrado.');
  if (role === 'member') {
    const admins = await deps.db.select({ userId: conversationMembers.userId }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.role, 'admin'), isNull(conversationMembers.leftAt)));
    if (admins.length <= 1 && admins[0]?.userId === userId) throw conflict('O grupo precisa de pelo menos um administrador.');
  }
  await deps.db.update(conversationMembers).set({ role }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  await recordAudit(deps.db, { actor: ctx, action: 'chat.member_role', resourceType: 'conversation', resourceId: conversationId, outcome: 'success', metadata: { userId, role }, meta });
  deps.realtime.toUsers(await activeMemberIds(deps, conversationId), 'conversation:updated', { id: conversationId });
}

/* ------------------------------------------------------------------ views */

export async function listConversations(deps: Deps, ctx: AuthContext) {
  const { db } = deps;
  const rows = await db
    .select({ conv: conversations, member: conversationMembers })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, ctx.userId), isNull(conversationMembers.leftAt), isNull(conversations.archivedAt)))
    .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
    .limit(200);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.conv.id);

  const [lastMessages, unread, directOthers] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.body, m.kind, m.created_at, m.deleted_at, u.display_name AS sender_name, m.sender_id
      FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      ORDER BY m.conversation_id, m.created_at DESC`),
    db.execute(sql`
      SELECT m.conversation_id, count(*)::int AS n
      FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${ctx.userId}
      WHERE m.conversation_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        AND m.deleted_at IS NULL AND m.kind = 'user' AND m.sender_id <> ${ctx.userId}
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at) AND m.created_at >= cm.joined_at
      GROUP BY m.conversation_id`),
    db.select({ conversationId: conversationMembers.conversationId, user: users })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(inArray(conversationMembers.conversationId, ids), eq(conversations.type, 'direct'), ne(conversationMembers.userId, ctx.userId))),
  ]);
  const lastBy = new Map((lastMessages.rows as { conversation_id: string; body: string; kind: string; created_at: Date; deleted_at: Date | null; sender_name: string | null; sender_id: string | null }[]).map((r) => [r.conversation_id, r]));
  const unreadBy = new Map((unread.rows as { conversation_id: string; n: number }[]).map((r) => [r.conversation_id, r.n]));
  const otherBy = new Map(directOthers.map((d) => [d.conversationId, d.user]));
  const presence = await presenceForUsers(deps, [...otherBy.values()].map((u) => u.id));

  return rows.map(({ conv, member }) => {
    const last = lastBy.get(conv.id);
    const other = otherBy.get(conv.id);
    return {
      id: conv.id,
      type: conv.type,
      name: conv.type === 'direct' ? other?.displayName ?? 'Conversa' : conv.name,
      description: conv.description,
      teamId: conv.teamId,
      other: other ? { ...toUserSummary(other), presence: presence.get(other.id) ?? null } : null,
      role: member.role,
      notifications: member.notifications,
      unread: unreadBy.get(conv.id) ?? 0,
      lastMessage: last
        ? {
            body: last.deleted_at ? 'Mensagem apagada' : last.body.slice(0, 120),
            kind: last.kind,
            senderName: last.sender_id === ctx.userId ? 'Você' : last.sender_name,
            createdAt: last.created_at,
          }
        : null,
      lastActivityAt: conv.lastMessageAt ?? conv.createdAt,
    };
  });
}

export async function conversationDetail(deps: Deps, ctx: AuthContext, id: string) {
  const { conv, member } = await requireMember(deps, ctx, id);
  const rows = await deps.db
    .select({ m: conversationMembers, user: users })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)))
    .orderBy(asc(users.displayName));
  const presence = await presenceForUsers(deps, rows.map((r) => r.user.id));
  const other = conv.type === 'direct' ? rows.find((r) => r.user.id !== ctx.userId)?.user : undefined;
  return {
    id: conv.id,
    type: conv.type,
    name: conv.type === 'direct' ? other?.displayName ?? 'Conversa' : conv.name,
    description: conv.description,
    teamId: conv.teamId,
    allowMembersInvite: conv.allowMembersInvite,
    createdAt: conv.createdAt,
    me: { role: member.role, notifications: member.notifications, lastReadAt: member.lastReadAt },
    members: rows.map((r) => ({
      ...toUserSummary(r.user),
      role: r.m.role,
      lastReadAt: r.m.lastReadAt,
      presence: presence.get(r.user.id) ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ messages */

type MessageRow = typeof messages.$inferSelect;

export async function messageViews(deps: Deps, rows: MessageRow[]) {
  if (!rows.length) return [];
  const { db } = deps;
  const ids = rows.map((r) => r.id);
  const replyIds = rows.map((r) => r.replyToId).filter((x): x is string => !!x);
  const [att, reactions, mentions, replies] = await Promise.all([
    db.select({ messageId: messageAttachments.messageId, file: files }).from(messageAttachments).innerJoin(files, eq(files.id, messageAttachments.fileId)).where(inArray(messageAttachments.messageId, ids)),
    db.select().from(messageReactions).where(inArray(messageReactions.messageId, ids)),
    db.select().from(messageMentions).where(inArray(messageMentions.messageId, ids)),
    replyIds.length ? db.select().from(messages).where(inArray(messages.id, replyIds)) : Promise.resolve([]),
  ]);
  const senderIds = new Set<string>();
  rows.forEach((r) => r.senderId && senderIds.add(r.senderId));
  replies.forEach((r) => r.senderId && senderIds.add(r.senderId));
  const senders = senderIds.size ? await db.select().from(users).where(inArray(users.id, [...senderIds])) : [];
  const byId = new Map(senders.map((s) => [s.id, toUserSummary(s)]));
  const replyBy = new Map(replies.map((r) => [r.id, r]));

  return rows.map((r) => {
    const reply = r.replyToId ? replyBy.get(r.replyToId) : undefined;
    const grouped = new Map<string, string[]>();
    reactions.filter((x) => x.messageId === r.id).forEach((x) => grouped.set(x.emoji, [...(grouped.get(x.emoji) ?? []), x.userId]));
    return {
      id: r.id,
      conversationId: r.conversationId,
      kind: r.kind,
      sender: r.senderId ? byId.get(r.senderId) ?? null : null,
      body: r.deletedAt ? '' : r.body,
      deleted: !!r.deletedAt,
      important: r.important,
      clientNonce: r.clientNonce,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      replyTo: reply
        ? { id: reply.id, body: reply.deletedAt ? 'Mensagem apagada' : reply.body.slice(0, 160), senderName: reply.senderId ? byId.get(reply.senderId)?.displayName ?? null : null }
        : null,
      attachments: r.deletedAt ? [] : att.filter((a) => a.messageId === r.id).map((a) => fileView(a.file)),
      reactions: [...grouped.entries()].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds })),
      mentions: mentions.filter((m) => m.messageId === r.id).map((m) => m.userId),
    };
  });
}

export async function listMessages(deps: Deps, ctx: AuthContext, conversationId: string, before: string | undefined, limit: number) {
  const { member } = await requireMember(deps, ctx, conversationId);
  // Members only see history from when they (re)joined a group.
  const rows = await deps.db
    .select()
    .from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      before ? lt(messages.createdAt, new Date(before)) : undefined,
      gt(messages.createdAt, new Date(member.joinedAt.getTime() - 1)),
    ))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return { items: await messageViews(deps, page), hasMore };
}

export async function sendMessage(
  deps: Deps,
  ctx: AuthContext,
  conversationId: string,
  input: { body: string; clientNonce: string; replyToId?: string | null; attachmentIds: string[]; mentions: string[]; important: boolean },
) {
  const { db } = deps;
  const { conv } = await requireMember(deps, ctx, conversationId);
  if (conv.archivedAt) throw conflict('Esta conversa está arquivada.');
  const body = input.body.trim();
  if (!body && input.attachmentIds.length === 0) throw badRequest('A mensagem está vazia.');

  // Idempotency: a retried send returns the original message instead of duplicating it.
  const [dup] = await db.select().from(messages).where(and(eq(messages.senderId, ctx.userId), eq(messages.clientNonce, input.clientNonce)));
  if (dup) {
    if (dup.conversationId !== conversationId) throw conflict('Identificador de envio já utilizado.');
    return (await messageViews(deps, [dup]))[0]!;
  }

  if (input.replyToId) {
    const [r] = await db.select({ c: messages.conversationId }).from(messages).where(eq(messages.id, input.replyToId));
    if (!r || r.c !== conversationId) throw badRequest('Mensagem respondida inválida.');
  }
  const members = await activeMemberIds(deps, conversationId);
  const mentions = [...new Set(input.mentions)].filter((m) => members.includes(m) && m !== ctx.userId);
  if (input.attachmentIds.length) {
    const ok = await db
      .select({ id: files.id })
      .from(files)
      .leftJoin(messageAttachments, eq(messageAttachments.fileId, files.id))
      .where(and(inArray(files.id, input.attachmentIds), eq(files.uploadedBy, ctx.userId), eq(files.purpose, 'message'), eq(files.contextId, conversationId), isNull(messageAttachments.fileId)));
    if (ok.length !== new Set(input.attachmentIds).size) throw badRequest('Anexo inválido.');
  }

  const saved = await db.transaction(async (tx) => {
    const [m] = await tx.insert(messages).values({
      conversationId,
      senderId: ctx.userId,
      body,
      replyToId: input.replyToId ?? null,
      clientNonce: input.clientNonce,
      important: input.important,
    }).returning();
    if (input.attachmentIds.length) await tx.insert(messageAttachments).values(input.attachmentIds.map((fileId) => ({ fileId, messageId: m!.id })));
    if (mentions.length) await tx.insert(messageMentions).values(mentions.map((userId) => ({ messageId: m!.id, userId })));
    await tx.update(conversations).set({ lastMessageAt: m!.createdAt }).where(eq(conversations.id, conversationId));
    await tx.update(conversationMembers).set({ lastReadAt: m!.createdAt }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, ctx.userId)));
    return m!;
  });
  const [view] = await messageViews(deps, [saved]);
  deps.realtime.toUsers(members, 'message:new', view);

  // Notifications respect each member's per-conversation setting.
  const settings = await db.select({ userId: conversationMembers.userId, level: conversationMembers.notifications })
    .from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
  const allLevel = settings.filter((s) => s.level === 'all' && !mentions.includes(s.userId)).map((s) => s.userId);
  const mentionTargets = settings.filter((s) => s.level !== 'none' && mentions.includes(s.userId)).map((s) => s.userId);
  const where = conv.type === 'direct' ? ctx.user.displayName : `${ctx.user.displayName} em "${conv.name}"`;
  const snippet = body ? body.slice(0, 120) : 'Enviou um anexo';
  await notify(deps, { userIds: allLevel, excludeUserId: ctx.userId, category: 'message', title: `Nova mensagem de ${where}`, body: snippet, link: `/conversas/${conversationId}`, resourceType: 'conversation', resourceId: conversationId, dedupeKey: `conv:${conversationId}` });
  await notify(deps, { userIds: mentionTargets, excludeUserId: ctx.userId, category: 'mention', title: `${ctx.user.displayName} mencionou você${conv.type === 'group' ? ` em "${conv.name}"` : ''}`, body: snippet, link: `/conversas/${conversationId}`, resourceType: 'conversation', resourceId: conversationId });
  return view!;
}

export async function editMessage(deps: Deps, ctx: AuthContext, messageId: string, body: string) {
  const [m] = await deps.db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || !(await membership(deps, m.conversationId, ctx.userId))) throw notFound('Mensagem não encontrada.');
  if (m.senderId !== ctx.userId || m.deletedAt) throw forbidden('Você só pode editar suas próprias mensagens.');
  const [u] = await deps.db.update(messages).set({ body, editedAt: new Date() }).where(eq(messages.id, messageId)).returning();
  const [view] = await messageViews(deps, [u!]);
  deps.realtime.toUsers(await activeMemberIds(deps, m.conversationId), 'message:updated', view);
  return view;
}

export async function deleteMessage(deps: Deps, ctx: AuthContext, messageId: string, meta?: RequestMeta) {
  const [m] = await deps.db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || !(await membership(deps, m.conversationId, ctx.userId))) throw notFound('Mensagem não encontrada.');
  if (m.senderId !== ctx.userId) throw forbidden('Você só pode apagar suas próprias mensagens.');
  const [u] = await deps.db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId)).returning();
  await recordAudit(deps.db, { actor: ctx, action: 'chat.message_deleted', resourceType: 'message', resourceId: messageId, outcome: 'success', meta });
  const [view] = await messageViews(deps, [u!]);
  deps.realtime.toUsers(await activeMemberIds(deps, m.conversationId), 'message:updated', view);
}

export async function toggleReaction(deps: Deps, ctx: AuthContext, messageId: string, emoji: string) {
  const [m] = await deps.db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || !(await membership(deps, m.conversationId, ctx.userId))) throw notFound('Mensagem não encontrada.');
  if (m.deletedAt || m.kind === 'system') throw badRequest('Não é possível reagir a esta mensagem.');
  const removed = await deps.db.delete(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, ctx.userId), eq(messageReactions.emoji, emoji))).returning();
  if (!removed.length) await deps.db.insert(messageReactions).values({ messageId, userId: ctx.userId, emoji }).onConflictDoNothing();
  const [view] = await messageViews(deps, [m]);
  deps.realtime.toUsers(await activeMemberIds(deps, m.conversationId), 'message:updated', view);
  return view;
}

export async function markRead(deps: Deps, ctx: AuthContext, conversationId: string) {
  await requireMember(deps, ctx, conversationId);
  const now = new Date();
  await deps.db.update(conversationMembers).set({ lastReadAt: now }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, ctx.userId)));
  deps.realtime.toUsers(await activeMemberIds(deps, conversationId), 'conversation:read', { conversationId, userId: ctx.userId, lastReadAt: now });
}

export async function searchMessages(deps: Deps, ctx: AuthContext, q: string, conversationId: string | undefined, limit: number) {
  const res = await deps.db.execute(sql`
    SELECT m.id, m.conversation_id, m.body, m.created_at, u.display_name AS sender_name,
           CASE WHEN c.type = 'direct' THEN (SELECT u2.display_name FROM conversation_members cm2 JOIN users u2 ON u2.id = cm2.user_id
                                            WHERE cm2.conversation_id = c.id AND cm2.user_id <> ${ctx.userId} LIMIT 1)
                ELSE c.name END AS conversation_name
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${ctx.userId} AND cm.left_at IS NULL
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.deleted_at IS NULL AND m.kind = 'user' AND m.created_at >= cm.joined_at
      AND to_tsvector('portuguese', m.body) @@ plainto_tsquery('portuguese', ${q})
      ${conversationId ? sql`AND m.conversation_id = ${conversationId}` : sql``}
    ORDER BY m.created_at DESC
    LIMIT ${limit}`);
  return (res.rows as { id: string; conversation_id: string; body: string; created_at: Date; sender_name: string | null; conversation_name: string | null }[]).map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    conversationName: r.conversation_name,
    senderName: r.sender_name,
    body: r.body.slice(0, 300),
    createdAt: r.created_at,
  }));
}

export async function conversationFiles(deps: Deps, ctx: AuthContext, conversationId: string) {
  const { member } = await requireMember(deps, ctx, conversationId);
  const rows = await deps.db
    .select({ file: files, messageId: messages.id, sender: users.displayName, sentAt: messages.createdAt })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .innerJoin(files, eq(files.id, messageAttachments.fileId))
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt), gt(messages.createdAt, member.joinedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...fileView(r.file), messageId: r.messageId, senderName: r.sender, sentAt: r.sentAt }));
}
