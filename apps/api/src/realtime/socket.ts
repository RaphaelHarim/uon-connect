import { parse as parseCookie } from 'cookie';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { Server as HttpServer } from 'node:http';
import { resolveSession, sessionCookieName } from '../auth/sessions.js';
import { type AuthContext, loadAuthContext } from '../authz/context.js';
import { meetingParticipants, meetings } from '../db/schema/index.js';
import type { Deps } from '../deps.js';
import { and, eq, isNull } from 'drizzle-orm';
import { activeMemberIds, membership } from '../modules/chat/service.js';
import { iceServers, participantRow } from '../modules/meetings/service.js';
import { broadcastPresence, touchLastSeen } from '../modules/presence/service.js';

interface SocketData {
  ctx: AuthContext;
}
type AppSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

const callRoom = (id: string) => `call:${id}`;
const uuid = z.uuid();

/**
 * Socket.IO server: authenticated by the same session cookie as the HTTP API, with an Origin
 * check against cross-site WebSocket hijacking. Clients only ever join their own `user:<id>` room
 * and the rooms of calls they are verified participants of.
 */
export function attachSocketServer(server: HttpServer, deps: Deps) {
  const { env, db, realtime, log } = deps;
  const allowedOrigins = new Set([new URL(env.APP_BASE_URL).origin, ...env.CORS_ORIGINS]);

  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    cors: env.CORS_ORIGINS.length ? { origin: env.CORS_ORIGINS, credentials: true } : undefined,
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  realtime.attach(io);

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return next(new Error('origin_not_allowed'));
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const token = cookies[sessionCookieName(env)];
      if (!token) return next(new Error('unauthorized'));
      const session = await resolveSession(db, env, token);
      if (!session) return next(new Error('unauthorized'));
      const ctx = await loadAuthContext(db, session.userId, session);
      if (!ctx) return next(new Error('unauthorized'));
      (socket as AppSocket).data.ctx = ctx;
      next();
    } catch (err) {
      log.warn({ err }, 'socket auth failed');
      next(new Error('unauthorized'));
    }
  });

  const socketsOf = (userId: string) => io.sockets.adapter.rooms.get(`user:${userId}`)?.size ?? 0;

  io.on('connection', (raw) => {
    const socket = raw as AppSocket;
    const { ctx } = socket.data;
    const first = socketsOf(ctx.userId) === 0;
    // Join and register handlers synchronously so events sent right after connecting aren't lost.
    void socket.join([`user:${ctx.userId}`, 'authenticated']);
    void (async () => {
      await touchLastSeen(db, ctx.userId).catch(() => undefined);
      if (first) await broadcastPresence(deps, ctx.userId).catch(() => undefined);
    })();

    // Untyped event handlers: every payload is validated before use.
    const on = (event: string, handler: (payload: unknown, ack?: (r: unknown) => void) => Promise<void> | void) =>
      (socket as unknown as Socket).on(event, async (payload: unknown, ack?: (r: unknown) => void) => {
        try {
          await handler(payload, typeof ack === 'function' ? ack : undefined);
        } catch (err) {
          log.warn({ err, event }, 'socket handler error');
          if (typeof ack === 'function') ack({ ok: false, error: 'internal_error' });
        }
      });

    on('presence:idle', async (payload) => {
      const idle = z.object({ idle: z.boolean() }).safeParse(payload);
      if (!idle.success) return;
      if (idle.data.idle) realtime.idleUsers.add(ctx.userId);
      else realtime.idleUsers.delete(ctx.userId);
      await broadcastPresence(deps, ctx.userId);
    });

    on('typing', async (payload) => {
      const p = z.object({ conversationId: uuid }).safeParse(payload);
      if (!p.success || !(await membership(deps, p.data.conversationId, ctx.userId))) return;
      const members = (await activeMemberIds(deps, p.data.conversationId)).filter((m) => m !== ctx.userId);
      realtime.toUsers(members, 'typing', { conversationId: p.data.conversationId, userId: ctx.userId, name: ctx.user.displayName });
    });

    /* ------------------------------------------------ WebRTC signalling (mesh) */

    on('call:join', async (payload, ack) => {
      const p = z.object({ meetingId: uuid }).safeParse(payload);
      if (!p.success) return ack?.({ ok: false, error: 'invalid' });
      const row = await participantRow(deps, p.data.meetingId, ctx.userId);
      if (!row || row.meeting.provider !== 'webrtc') return ack?.({ ok: false, error: 'not_found' });
      if (row.meeting.status === 'ended' || row.meeting.status === 'cancelled') return ack?.({ ok: false, error: 'ended' });
      const room = callRoom(p.data.meetingId);
      const current = await io.in(room).fetchSockets();
      if (current.length >= env.CALL_MAX_PARTICIPANTS) return ack?.({ ok: false, error: 'full' });
      await socket.join(room);
      const now = new Date();
      await db.update(meetingParticipants).set({ joinedAt: now, leftAt: null, inviteStatus: 'accepted' })
        .where(and(eq(meetingParticipants.meetingId, p.data.meetingId), eq(meetingParticipants.userId, ctx.userId)));
      if (row.meeting.status !== 'live') {
        await db.update(meetings).set({ status: 'live', startedAt: row.meeting.startedAt ?? now }).where(eq(meetings.id, p.data.meetingId));
      }
      const peers = current.map((s) => ({ socketId: s.id, userId: (s.data as SocketData).ctx.userId, name: (s.data as SocketData).ctx.user.displayName }));
      socket.to(room).emit('call:peer-joined', { socketId: socket.id, userId: ctx.userId, name: ctx.user.displayName });
      ack?.({ ok: true, peers, iceServers: iceServers(deps, ctx.userId), selfSocketId: socket.id });
    });

    on('call:signal', async (payload) => {
      const p = z.object({ meetingId: uuid, to: z.string().max(64), data: z.record(z.string(), z.unknown()) }).safeParse(payload);
      if (!p.success) return;
      const room = callRoom(p.data.meetingId);
      if (!socket.rooms.has(room)) return;
      const target = io.sockets.sockets.get(p.data.to);
      if (!target || !target.rooms.has(room)) return;
      target.emit('call:signal', { meetingId: p.data.meetingId, from: socket.id, userId: ctx.userId, data: p.data.data });
    });

    on('call:media', async (payload) => {
      const p = z.object({ meetingId: uuid, audio: z.boolean(), video: z.boolean() }).safeParse(payload);
      if (!p.success || !socket.rooms.has(callRoom(p.data.meetingId))) return;
      socket.to(callRoom(p.data.meetingId)).emit('call:media', { socketId: socket.id, userId: ctx.userId, audio: p.data.audio, video: p.data.video });
    });

    const leaveCall = async (meetingId: string) => {
      const room = callRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      await socket.leave(room);
      socket.to(room).emit('call:peer-left', { socketId: socket.id, userId: ctx.userId });
      await db.update(meetingParticipants).set({ leftAt: new Date() })
        .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, ctx.userId), isNull(meetingParticipants.leftAt)));
      const remaining = await io.in(room).fetchSockets();
      if (remaining.length === 0) {
        // Instant calls end when the last person leaves; scheduled meetings stay open until their host ends them.
        const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
        const instant = m && (!m.scheduledEndAt || m.scheduledEndAt < new Date());
        if (m && m.status === 'live' && instant) await db.update(meetings).set({ status: 'ended', endedAt: new Date() }).where(eq(meetings.id, meetingId));
      }
    };

    on('call:leave', async (payload) => {
      const p = z.object({ meetingId: uuid }).safeParse(payload);
      if (p.success) await leaveCall(p.data.meetingId);
    });

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('call:')) leaveCall(room.slice(5)).catch((err) => log.warn({ err }, 'call cleanup failed'));
      }
    });

    socket.on('disconnect', async () => {
      if (socketsOf(ctx.userId) === 0) {
        realtime.idleUsers.delete(ctx.userId);
        await touchLastSeen(db, ctx.userId).catch(() => undefined);
        await broadcastPresence(deps, ctx.userId).catch(() => undefined);
      }
    });
  });

  return io;
}
