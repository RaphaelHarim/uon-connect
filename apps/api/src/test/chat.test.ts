import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../app.js';
import { absenceSchedules, systemSettings } from '../db/schema/index.js';
import { runAbsenceTransitions } from '../modules/presence/service.js';
import { attachSocketServer } from '../realtime/socket.js';
import { createTestApp, login, PNG_1PX, userId, type Client } from './helpers.js';

let built: BuiltApp;
let baseUrl: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  built = await createTestApp();
  attachSocketServer(built.app.server, built.deps);
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(built.app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  // Let the server finish its disconnect handlers before the pool closes.
  await new Promise((r) => setTimeout(r, 300));
  built.deps.realtime.server?.close();
  await built.app.close();
});

function connect(c: Client, origin = 'http://localhost:5173'): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(baseUrl, { transports: ['websocket'], extraHeaders: { cookie: c.cookie, origin }, reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const nextEvent = <T>(s: Socket, event: string, timeout = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });

describe('direct conversations', () => {
  let ana: Client;
  let lucas: Client;
  let convId: string;

  beforeAll(async () => {
    ana = await login(built, 'bradesco1');
    lucas = await login(built, 'bradesco2');
    convId = (await ana.post('/conversations/direct', { userId: lucas.userId })).json().id;
  });

  it('opens a single conversation per pair', async () => {
    const again = (await lucas.post('/conversations/direct', { userId: ana.userId })).json().id;
    expect(again).toBe(convId);
  });

  it('delivers messages in real time and persists history', async () => {
    const socket = await connect(lucas);
    const received = nextEvent<{ body: string; sender: { id: string } }>(socket, 'message:new');
    const sent = await ana.post(`/conversations/${convId}/messages`, { body: 'Olá, Lucas! 👋', clientNonce: randomUUID() });
    expect(sent.status, sent.body).toBe(200);
    const msg = await received;
    expect(msg.body).toBe('Olá, Lucas! 👋');
    expect(msg.sender.id).toBe(ana.userId);
    const history = (await lucas.get(`/conversations/${convId}/messages`)).json();
    expect(history.items.at(-1).body).toBe('Olá, Lucas! 👋');
  });

  it('is idempotent on retries (same client nonce)', async () => {
    const nonce = randomUUID();
    const a = (await ana.post(`/conversations/${convId}/messages`, { body: 'reenvio', clientNonce: nonce })).json();
    const b = (await ana.post(`/conversations/${convId}/messages`, { body: 'reenvio', clientNonce: nonce })).json();
    expect(a.id).toBe(b.id);
    const history = (await ana.get(`/conversations/${convId}/messages?limit=100`)).json();
    expect(history.items.filter((m: { body: string }) => m.body === 'reenvio')).toHaveLength(1);
  });

  it('supports replies, reactions, edits and deletes by the author only', async () => {
    const original = (await ana.post(`/conversations/${convId}/messages`, { body: 'Mensagem original', clientNonce: randomUUID() })).json();
    const reply = (await lucas.post(`/conversations/${convId}/messages`, { body: 'Resposta', clientNonce: randomUUID(), replyToId: original.id })).json();
    expect(reply.replyTo.id).toBe(original.id);
    const reacted = (await lucas.post(`/messages/${original.id}/reactions`, { emoji: '👍' })).json();
    expect(reacted.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [lucas.userId] }]);
    expect((await lucas.post(`/messages/${original.id}/reactions`, { emoji: '💀' })).status).toBe(400);
    expect((await lucas.patch(`/messages/${original.id}`, { body: 'editado por outro' })).status).toBe(403);
    expect((await ana.patch(`/messages/${original.id}`, { body: 'Mensagem editada' })).json().editedAt).toBeTruthy();
    expect((await lucas.del(`/messages/${original.id}`)).status).toBe(403);
    expect((await ana.del(`/messages/${original.id}`)).status).toBe(200);
  });

  it('is invisible to non-members, including administrators', async () => {
    for (const who of ['itau1', 'platformAdmin', 'founder', 'coordBradesco'] as const) {
      const c = await login(built, who);
      expect((await c.get(`/conversations/${convId}`)).status, who).toBe(404);
      expect((await c.get(`/conversations/${convId}/messages`)).status, who).toBe(404);
      expect((await c.post(`/conversations/${convId}/messages`, { body: 'intruso', clientNonce: randomUUID() })).status, who).toBe(404);
    }
  });

  it('search only returns messages from the user\'s conversations', async () => {
    await ana.post(`/conversations/${convId}/messages`, { body: 'vistoria confidencial palmeiras', clientNonce: randomUUID() });
    const mine = (await lucas.get('/messages/search?q=palmeiras')).json();
    expect(mine.length).toBeGreaterThan(0);
    const other = await login(built, 'itau1');
    expect((await other.get('/messages/search?q=palmeiras')).json()).toHaveLength(0);
    const admin = await login(built, 'platformAdmin');
    expect((await admin.get('/search?q=palmeiras')).json().messages).toHaveLength(0);
  });

  it('shares files with members only', async () => {
    const up = await ana.upload(`/conversations/${convId}/files`, 'foto.png', PNG_1PX, 'image/png');
    expect(up.status, up.body).toBe(200);
    const fileId = up.json().id;
    // Not yet sent: only the uploader can read it.
    expect((await lucas.get(`/files/${fileId}`)).status).toBe(404);
    const m = await ana.post(`/conversations/${convId}/messages`, { body: '', clientNonce: randomUUID(), attachmentIds: [fileId] });
    expect(m.status, m.body).toBe(200);
    expect((await lucas.get(`/files/${fileId}`)).status).toBe(200);
    const outsider = await login(built, 'itau1');
    expect((await outsider.get(`/files/${fileId}`)).status).toBe(404);
    // A file can't be re-attached in another conversation.
    expect((await ana.post(`/conversations/${convId}/messages`, { body: 'de novo', clientNonce: randomUUID(), attachmentIds: [fileId] })).status).toBe(400);
    expect((await lucas.get(`/conversations/${convId}/files`)).json().some((f: { id: string }) => f.id === fileId)).toBe(true);
  });

  it('tracks unread counts and read receipts', async () => {
    const before = (await lucas.get('/conversations')).json().find((c: { id: string }) => c.id === convId);
    expect(before.unread).toBeGreaterThan(0);
    await lucas.post(`/conversations/${convId}/read`);
    const after = (await lucas.get('/conversations')).json().find((c: { id: string }) => c.id === convId);
    expect(after.unread).toBe(0);
  });
});

describe('groups', () => {
  it('creates a group, manages members and respects admin rights', async () => {
    const coord = await login(built, 'coordItau');
    const mariana = await login(built, 'itau1');
    const gabriel = await userId(built, 'itau2');
    const g = (await coord.post('/conversations/groups', { name: 'Projeto Revisão Itaú', memberIds: [mariana.userId] })).json().id;
    const detail = (await mariana.get(`/conversations/${g}`)).json();
    expect(detail.members).toHaveLength(2);
    expect(detail.me.role).toBe('member');
    // Regular member can't add people unless the group allows it.
    expect((await mariana.post(`/conversations/${g}/members`, { userIds: [gabriel] })).status).toBe(403);
    expect((await coord.post(`/conversations/${g}/members`, { userIds: [gabriel] })).json().added).toBe(1);
    expect((await mariana.del(`/conversations/${g}/members/${gabriel}`)).status).toBe(403);
    // Leaving works; history after leaving is no longer accessible.
    expect((await mariana.del(`/conversations/${g}/members/${mariana.userId}`)).status).toBe(200);
    expect((await mariana.get(`/conversations/${g}/messages`)).status).toBe(404);
    // The last admin leaving promotes someone else.
    expect((await coord.del(`/conversations/${g}/members/${coord.userId}`)).status).toBe(200);
    const gab = await login(built, 'itau2');
    expect((await gab.get(`/conversations/${g}`)).json().me.role).toBe('admin');
  });

  it('team-linked groups follow team membership', async () => {
    const admin = await login(built, 'platformAdmin');
    const structure = (await admin.get('/org/structure')).json();
    const sant = structure.departments.flatMap((d: { teams: { id: string; name: string }[] }) => d.teams).find((t: { name: string }) => t.name === 'Carteira Santander');
    const coord = await login(built, 'coordSantander');
    const created = await coord.post('/conversations/groups', { name: 'Equipe Santander (oficial)', teamId: sant.id });
    expect(created.status, created.body).toBe(200);
    const gid = created.json().id;
    const members = (await coord.get(`/conversations/${gid}`)).json().members.map((m: { id: string }) => m.id);
    expect(members).toEqual(expect.arrayContaining([await userId(built, 'santander1'), await userId(built, 'santander2')]));
    // A coordinator of another team can't create the official group of this team.
    const other = await login(built, 'coordItau');
    expect((await other.post('/conversations/groups', { name: 'Grupo indevido', teamId: sant.id })).status).toBe(403);
    // Adding someone to the team adds them to the linked group.
    const newcomer = (await admin.post('/admin/users', { email: 'novato.santander@demo.uonconnect.local', displayName: 'Novato Santander' })).json().id;
    expect((await admin.put(`/admin/users/${newcomer}/teams`, { teamId: sant.id, role: 'member' })).status).toBe(200);
    const after = (await coord.get(`/conversations/${gid}`)).json().members.map((m: { id: string }) => m.id);
    expect(after).toContain(newcomer);
    expect((await admin.del(`/admin/users/${newcomer}/teams/${sant.id}`)).status).toBe(200);
    expect((await coord.get(`/conversations/${gid}`)).json().members.map((m: { id: string }) => m.id)).not.toContain(newcomer);
  });

  it('mentions notify the mentioned member', async () => {
    const coord = await login(built, 'coordBradesco');
    const ana = await login(built, 'bradesco1');
    const g = (await coord.post('/conversations/groups', { name: 'Menções', memberIds: [ana.userId] })).json().id;
    await coord.post(`/conversations/${g}/messages`, { body: '@Ana pode revisar?', clientNonce: randomUUID(), mentions: [ana.userId] });
    const notes = (await ana.get('/notifications?category=mention')).json();
    expect(notes.items[0].title).toContain('mencionou você');
  });

  it('honours the department-only contact policy', async () => {
    await built.deps.db.insert(systemSettings).values({ key: 'chatDirectPolicy', value: 'department' }).onConflictDoUpdate({ target: systemSettings.key, set: { value: 'department' } });
    try {
      const camila = await login(built, 'forensic1');
      const ana = await userId(built, 'bradesco1');
      expect((await camila.post('/conversations/direct', { userId: ana })).status).toBe(403);
      const coord = await userId(built, 'forensicHead');
      expect((await camila.post('/conversations/direct', { userId: coord })).status).toBe(200);
    } finally {
      await built.deps.db.delete(systemSettings).where(eq(systemSettings.key, 'chatDirectPolicy'));
    }
  });
});

describe('realtime transport security', () => {
  it('rejects sockets without a session or from another origin', async () => {
    await expect(new Promise((resolve, reject) => {
      const s = ioClient(baseUrl, { transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    })).rejects.toThrow(/unauthorized/);
    const ana = await login(built, 'bradesco1');
    await expect(connect(ana, 'https://evil.example')).rejects.toThrow(/origin_not_allowed/);
  });

  it('broadcasts presence and typing only to the right people', async () => {
    const ana = await login(built, 'bradesco1');
    const lucas = await login(built, 'bradesco2');
    const conv = (await ana.post('/conversations/direct', { userId: lucas.userId })).json().id;
    const ls = await connect(lucas);
    const presence = nextEvent<{ userId: string; status: string }>(ls, 'presence:update');
    const as = await connect(ana);
    expect((await presence).userId).toBe(ana.userId);
    const typing = nextEvent<{ conversationId: string; userId: string }>(ls, 'typing');
    as.emit('typing', { conversationId: conv });
    expect(await typing).toMatchObject({ conversationId: conv, userId: ana.userId });
  });
});

describe('presence and scheduled absences', () => {
  it('derives status from manual setting, connection and absence (server-side activation)', async () => {
    const ana = await login(built, 'bradesco1');
    await ana.put('/me/presence', { status: 'busy', message: 'Em vistoria' });
    let p = (await ana.get(`/presence?ids=${ana.userId}`)).json()[0];
    expect(p).toMatchObject({ status: 'busy', source: 'manual', message: 'Em vistoria' });

    const start = new Date(Date.now() + 60_000);
    const end = new Date(Date.now() + 3 * 3_600_000);
    const sub = await userId(built, 'bradesco2');
    const a = await ana.post('/me/absences', { startsAt: start.toISOString(), endsAt: end.toISOString(), message: 'Em treinamento externo', substituteUserId: sub, visibility: 'team' });
    expect(a.status, a.body).toBe(200);
    expect(a.json().status).toBe('scheduled');
    // Overlapping absences are rejected.
    expect((await ana.post('/me/absences', { startsAt: start.toISOString(), endsAt: end.toISOString() })).status).toBe(409);

    // Simulate the scheduler running after the start time.
    await runAbsenceTransitions(built.deps, new Date(start.getTime() + 1000));
    p = (await ana.get(`/presence?ids=${ana.userId}`)).json()[0];
    expect(p).toMatchObject({ status: 'away', source: 'absence' });

    // Visibility "team": a teammate sees the message, someone from another team doesn't.
    const coord = await login(built, 'coordBradesco');
    expect((await coord.get(`/users/${ana.userId}/absence`)).json().absence.message).toBe('Em treinamento externo');
    const outsider = await login(built, 'itau1');
    expect((await outsider.get(`/users/${ana.userId}/absence`)).json().absence).toMatchObject({ restricted: true });
    expect((await outsider.get(`/users/${ana.userId}/absence`)).json().absence.message).toBeUndefined();

    // The substitute is notified but gains no access to the absent person's conversations.
    const lucas = await login(built, 'bradesco2');
    expect((await lucas.get('/notifications?category=absence')).json().items.length).toBeGreaterThan(0);
    const coordConv = (await coord.post('/conversations/direct', { userId: ana.userId })).json().id;
    expect((await lucas.get(`/conversations/${coordConv}`)).status).toBe(404);

    // Ending the absence restores presence.
    expect((await ana.post(`/me/absences/${a.json().id}/end`)).status).toBe(200);
    const [row] = await built.deps.db.select().from(absenceSchedules).where(eq(absenceSchedules.id, a.json().id));
    expect(row!.status).toBe('ended');
    await ana.put('/me/presence', { status: null });
  });
});

describe('meetings and calls', () => {
  it('creates a call, limits it to participants and relays WebRTC signalling', async () => {
    const coord = await login(built, 'coordBradesco');
    const ana = await login(built, 'bradesco1');
    const anaSocket = await connect(ana);
    const invite = nextEvent<{ meetingId: string }>(anaSocket, 'call:invite');
    const created = await coord.post('/meetings', { title: 'Alinhamento rápido', participantIds: [ana.userId] });
    expect(created.status, created.body).toBe(200);
    const meetingId = created.json().id;
    expect((await invite).meetingId).toBe(meetingId);

    const outsider = await login(built, 'itau1');
    expect((await outsider.get(`/meetings/${meetingId}`)).status).toBe(404);
    const outsiderSocket = await connect(outsider);
    const denied = await outsiderSocket.emitWithAck('call:join', { meetingId });
    expect(denied).toMatchObject({ ok: false, error: 'not_found' });

    const coordSocket = await connect(coord);
    const first = await coordSocket.emitWithAck('call:join', { meetingId });
    expect(first.ok).toBe(true);
    expect(first.peers).toHaveLength(0);
    const joinedNotice = nextEvent<{ userId: string; socketId: string }>(coordSocket, 'call:peer-joined');
    const second = await anaSocket.emitWithAck('call:join', { meetingId });
    expect(second.peers.map((p: { userId: string }) => p.userId)).toEqual([coord.userId]);
    const joined = await joinedNotice;
    expect(joined.userId).toBe(ana.userId);

    const signal = nextEvent<{ from: string; data: { type: string } }>(coordSocket, 'call:signal');
    anaSocket.emit('call:signal', { meetingId, to: second.peers[0].socketId, data: { type: 'offer', sdp: 'v=0' } });
    expect((await signal).data.type).toBe('offer');

    // Signals can't be sent to sockets outside the call.
    const leak = new Promise((resolve) => {
      outsiderSocket.once('call:signal', () => resolve('leaked'));
      setTimeout(() => resolve('blocked'), 400);
    });
    anaSocket.emit('call:signal', { meetingId, to: outsiderSocket.id, data: { type: 'offer' } });
    expect(await leak).toBe('blocked');

    const detail = (await coord.get(`/meetings/${meetingId}`)).json();
    expect(detail.status).toBe('live');
    // Only the host may end it; then a group can be created from the participants.
    expect((await ana.post(`/meetings/${meetingId}/end`)).status).toBe(403);
    const ended = nextEvent(anaSocket, 'call:ended');
    expect((await coord.post(`/meetings/${meetingId}/end`)).status).toBe(200);
    await ended;
    const group = await ana.post(`/meetings/${meetingId}/create-group`, { name: 'Grupo da chamada' });
    expect(group.status, group.body).toBe(200);
    const members = (await ana.get(`/conversations/${group.json().id}`)).json().members.map((m: { id: string }) => m.id);
    expect(members.sort()).toEqual([ana.userId, coord.userId].sort());
  });

  it('refuses Teams meetings when the integration is not configured', async () => {
    const coord = await login(built, 'coordBradesco');
    const r = await coord.post('/meetings', { title: 'Reunião Teams', provider: 'teams' });
    expect(r.status).toBe(503);
  });

  it('enforces the participant limit for platform calls', async () => {
    const small = await createTestApp({ CALL_MAX_PARTICIPANTS: '2' });
    const coord = await login(small, 'coordBradesco');
    const ids = [await userId(small, 'bradesco1'), await userId(small, 'bradesco2')];
    expect((await coord.post('/meetings', { title: 'Muitos', participantIds: ids })).status).toBe(400);
    await small.app.close();
  });
});
