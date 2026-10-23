import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../authz/context.js';
import { meetingParticipants, meetings, users } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { turnCredentials } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, unavailable } from '../../lib/errors.js';
import { toUserSummary } from '../../lib/users.js';
import { type RequestMeta, recordAudit } from '../audit/service.js';
import { canContact, membership } from '../chat/service.js';
import { notify } from '../notifications/service.js';
import type { GraphClient } from '../integrations/graph.js';

export function iceServers(deps: Deps, userId: string) {
  const { env } = deps;
  const servers: { urls: string[]; username?: string; credential?: string }[] = [];
  if (env.WEBRTC_STUN_URLS.length) servers.push({ urls: env.WEBRTC_STUN_URLS });
  if (env.TURN_URLS.length && env.TURN_SECRET) {
    servers.push({ urls: env.TURN_URLS, ...turnCredentials(env.TURN_SECRET, userId, env.TURN_TTL_SECONDS) });
  }
  return servers;
}

export async function participantRow(deps: Deps, meetingId: string, userId: string) {
  const [row] = await deps.db
    .select({ meeting: meetings, participant: meetingParticipants })
    .from(meetings)
    .innerJoin(meetingParticipants, and(eq(meetingParticipants.meetingId, meetings.id), eq(meetingParticipants.userId, userId)))
    .where(eq(meetings.id, meetingId));
  return row ?? null;
}

async function requireParticipant(deps: Deps, ctx: AuthContext, meetingId: string) {
  const row = await participantRow(deps, meetingId, ctx.userId);
  if (!row) throw notFound('Reunião não encontrada.');
  return row;
}

export async function createMeeting(
  deps: Deps,
  ctx: AuthContext,
  input: { title: string; participantIds: string[]; conversationId?: string | null; scheduledStartAt?: string | null; scheduledEndAt?: string | null; provider: 'webrtc' | 'teams' },
  graph: GraphClient,
  meta?: RequestMeta,
) {
  const { db, env } = deps;
  const invitees = [...new Set(input.participantIds)].filter((id) => id !== ctx.userId);
  if (input.conversationId) {
    if (!(await membership(deps, input.conversationId, ctx.userId))) throw notFound('Conversa não encontrada.');
    for (const id of invitees) {
      if (!(await membership(deps, input.conversationId, id))) throw forbidden('Todos os convidados devem participar da conversa.');
    }
  } else {
    for (const id of invitees) {
      if (!(await canContact(deps, ctx, id))) throw forbidden('Um dos convidados não pode ser convidado conforme a política da empresa.');
    }
  }
  if (input.provider === 'webrtc' && invitees.length + 1 > env.CALL_MAX_PARTICIPANTS) {
    throw badRequest(`Chamadas da plataforma suportam até ${env.CALL_MAX_PARTICIPANTS} participantes. Para reuniões maiores use o Microsoft Teams (quando configurado).`);
  }
  const start = input.scheduledStartAt ? new Date(input.scheduledStartAt) : new Date();
  const end = input.scheduledEndAt ? new Date(input.scheduledEndAt) : null;
  if (end && end <= start) throw badRequest('O término deve ser posterior ao início.');

  let externalJoinUrl: string | null = null;
  if (input.provider === 'teams') {
    if (!env.GRAPH_TEAMS_MEETINGS_ENABLED) throw unavailable('A criação de reuniões no Microsoft Teams não está configurada.');
    externalJoinUrl = await graph.createOnlineMeeting(ctx.userId, { subject: input.title, start, end: end ?? new Date(start.getTime() + 3_600_000) });
  }

  const meeting = await db.transaction(async (tx) => {
    const [m] = await tx.insert(meetings).values({
      title: input.title,
      conversationId: input.conversationId ?? null,
      createdBy: ctx.userId,
      provider: input.provider,
      scheduledStartAt: start,
      scheduledEndAt: end,
      externalJoinUrl,
    }).returning();
    await tx.insert(meetingParticipants).values([
      { meetingId: m!.id, userId: ctx.userId, role: 'host', inviteStatus: 'accepted' },
      ...invitees.map((userId) => ({ meetingId: m!.id, userId })),
    ]);
    await recordAudit(tx, { actor: ctx, action: 'meeting.created', resourceType: 'meeting', resourceId: m!.id, outcome: 'success', metadata: { provider: input.provider, participants: invitees.length + 1 }, meta });
    return m!;
  });

  const instant = !input.scheduledStartAt;
  await notify(deps, {
    userIds: invitees,
    category: 'meeting_invite',
    title: instant ? `${ctx.user.displayName} está chamando você` : `Convite para reunião: ${input.title}`,
    link: `/reunioes/${meeting.id}`,
    resourceType: 'meeting',
    resourceId: meeting.id,
  });
  if (instant) deps.realtime.toUsers(invitees, 'call:invite', { meetingId: meeting.id, title: meeting.title, from: { id: ctx.userId, name: ctx.user.displayName } });
  return meeting;
}

export async function meetingDetail(deps: Deps, ctx: AuthContext, meetingId: string) {
  const { meeting, participant } = await requireParticipant(deps, ctx, meetingId);
  const rows = await deps.db
    .select({ p: meetingParticipants, user: users })
    .from(meetingParticipants)
    .innerJoin(users, eq(users.id, meetingParticipants.userId))
    .where(eq(meetingParticipants.meetingId, meetingId))
    .orderBy(asc(users.displayName));
  return {
    ...meeting,
    me: { role: participant.role, inviteStatus: participant.inviteStatus },
    participants: rows.map((r) => ({ ...toUserSummary(r.user), role: r.p.role, inviteStatus: r.p.inviteStatus, joinedAt: r.p.joinedAt, leftAt: r.p.leftAt })),
  };
}

export async function listMeetings(deps: Deps, ctx: AuthContext, range: 'upcoming' | 'past') {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 12 * 3_600_000);
  const rows = await deps.db
    .select({ meeting: meetings, participant: meetingParticipants })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
    .where(and(
      eq(meetingParticipants.userId, ctx.userId),
      range === 'upcoming'
        ? and(inArray(meetings.status, ['scheduled', 'live']), or(gte(meetings.scheduledStartAt, dayAgo), eq(meetings.status, 'live')))
        : or(inArray(meetings.status, ['ended', 'cancelled']), lt(meetings.scheduledStartAt, dayAgo)),
    ))
    .orderBy(range === 'upcoming' ? asc(meetings.scheduledStartAt) : desc(meetings.scheduledStartAt))
    .limit(50);
  const ids = rows.map((r) => r.meeting.id);
  const counts = ids.length
    ? await deps.db.select({ id: meetingParticipants.meetingId, n: sql<number>`count(*)::int` }).from(meetingParticipants).where(inArray(meetingParticipants.meetingId, ids)).groupBy(meetingParticipants.meetingId)
    : [];
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((r) => ({ ...r.meeting, me: { role: r.participant.role, inviteStatus: r.participant.inviteStatus }, participantCount: byId.get(r.meeting.id) ?? 1 }));
}

export async function respondMeeting(deps: Deps, ctx: AuthContext, meetingId: string, response: 'accepted' | 'declined') {
  const { meeting } = await requireParticipant(deps, ctx, meetingId);
  if (meeting.status === 'ended' || meeting.status === 'cancelled') throw conflict('Esta reunião já foi encerrada.');
  await deps.db.update(meetingParticipants).set({ inviteStatus: response })
    .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, ctx.userId)));
  const host = await deps.db.select({ id: meetingParticipants.userId }).from(meetingParticipants)
    .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.role, 'host')));
  deps.realtime.toUsers(host.map((h) => h.id), 'meeting:response', { meetingId, userId: ctx.userId, response });
}

export async function addParticipants(deps: Deps, ctx: AuthContext, meetingId: string, userIds: string[]) {
  const { meeting, participant } = await requireParticipant(deps, ctx, meetingId);
  if (participant.role !== 'host') throw forbidden('Somente o organizador pode convidar participantes.');
  if (meeting.status === 'ended' || meeting.status === 'cancelled') throw conflict('Esta reunião já foi encerrada.');
  const existing = await deps.db.select({ id: meetingParticipants.userId }).from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
  const have = new Set(existing.map((e) => e.id));
  const add = [...new Set(userIds)].filter((u) => !have.has(u));
  if (meeting.provider === 'webrtc' && have.size + add.length > deps.env.CALL_MAX_PARTICIPANTS) throw badRequest(`Limite de ${deps.env.CALL_MAX_PARTICIPANTS} participantes.`);
  for (const id of add) if (!(await canContact(deps, ctx, id))) throw forbidden('Um dos convidados não pode ser convidado.');
  if (!add.length) return;
  await deps.db.insert(meetingParticipants).values(add.map((userId) => ({ meetingId, userId })));
  await notify(deps, { userIds: add, category: 'meeting_invite', title: `${ctx.user.displayName} convidou você para "${meeting.title}"`, link: `/reunioes/${meetingId}`, resourceType: 'meeting', resourceId: meetingId });
  if (meeting.status === 'live') deps.realtime.toUsers(add, 'call:invite', { meetingId, title: meeting.title, from: { id: ctx.userId, name: ctx.user.displayName } });
}

export async function endMeeting(deps: Deps, ctx: AuthContext, meetingId: string, meta?: RequestMeta) {
  const { meeting, participant } = await requireParticipant(deps, ctx, meetingId);
  if (participant.role !== 'host') throw forbidden('Somente o organizador pode encerrar a reunião para todos.');
  if (meeting.status === 'ended' || meeting.status === 'cancelled') return;
  const status = meeting.status === 'scheduled' && !meeting.startedAt ? 'cancelled' : 'ended';
  await deps.db.update(meetings).set({ status, endedAt: new Date() }).where(eq(meetings.id, meetingId));
  await deps.db.update(meetingParticipants).set({ leftAt: new Date() }).where(and(eq(meetingParticipants.meetingId, meetingId), isNull(meetingParticipants.leftAt), isNotNull(meetingParticipants.joinedAt)));
  await recordAudit(deps.db, { actor: ctx, action: `meeting.${status}`, resourceType: 'meeting', resourceId: meetingId, outcome: 'success', meta });
  deps.realtime.server?.to(`call:${meetingId}`).emit('call:ended', { meetingId });
  const all = await deps.db.select({ id: meetingParticipants.userId }).from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
  deps.realtime.toUsers(all.map((a) => a.id), 'meeting:updated', { meetingId, status });
}

export async function participantIdsForGroup(deps: Deps, ctx: AuthContext, meetingId: string) {
  await requireParticipant(deps, ctx, meetingId);
  const rows = await deps.db.select({ id: meetingParticipants.userId }).from(meetingParticipants)
    .where(and(eq(meetingParticipants.meetingId, meetingId), ne(meetingParticipants.inviteStatus, 'declined')));
  return rows.map((r) => r.id);
}
