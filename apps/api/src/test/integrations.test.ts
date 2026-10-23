import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../app.js';
import { integrationStatus, jobs, notifications, oauthTokens, tickets } from '../db/schema/index.js';
import { BackgroundRunner } from '../jobs/runner.js';
import { encrypt } from '../lib/crypto.js';
import { GraphClient } from '../modules/integrations/graph.js';
import { createTestApp, login, userId } from './helpers.js';

let built: BuiltApp;
beforeAll(async () => {
  built = await createTestApp();
});
afterAll(async () => {
  await built.app.close();
});

describe('e-mail notifications via the job queue', () => {
  it('sends a minimal e-mail (title + link, no content) and marks the job done', async () => {
    const ana = await login(built, 'bradesco1');
    const options = (await ana.get('/tickets/form-options')).json();
    const cat = options.categories.find((c: { name: string }) => c.name === 'Suporte técnico').id;
    const ti = options.destinations.find((d: { destination: string; label: string }) => d.destination === 'service_desk' && d.label.includes('TI'));
    const created = (await ana.post('/tickets', { title: 'Senha do sistema de laudos expirou', description: 'CONTEUDO-SIGILOSO-123', categoryId: cat, priority: 'medium', destination: 'service_desk', targetId: ti.targetId })).json();
    const head = await login(built, 'tiHead');
    await head.post(`/tickets/${created.id}/assign`, { assigneeId: await userId(built, 'tiAgent') });

    const runner = new BackgroundRunner(built.deps, built.mailer);
    await runner.drainQueue(100);
    const mails = built.mailer.outbox.filter((m) => m.subject.includes(created.protocol));
    expect(mails.length).toBeGreaterThan(0);
    for (const m of mails) {
      expect(m.text).not.toContain('CONTEUDO-SIGILOSO-123');
      expect(m.text).toContain(`/chamados/${created.id}`);
    }
    const pending = await built.deps.db.select().from(jobs).where(eq(jobs.status, 'pending'));
    expect(pending).toHaveLength(0);
  });
});

describe('Microsoft Graph client', () => {
  const key = randomBytes(32).toString('base64');
  let graphApp: BuiltApp;
  beforeAll(async () => {
    graphApp = await createTestApp({
      ENTRA_TENANT_ID: '11111111-1111-1111-1111-111111111111', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
      ENTRA_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/entra/callback', GRAPH_CALENDAR_ENABLED: 'true', TOKEN_ENCRYPTION_KEY: key,
    });
  });
  afterAll(async () => {
    await graphApp.app.close();
  });

  it('reads calendar events with the stored delegated token and records health', async () => {
    const uid = await userId(graphApp, 'bradesco1');
    await graphApp.deps.db.insert(oauthTokens).values({ userId: uid, accessTokenEnc: encrypt('fake-access-token', key), scopes: 'Calendars.Read', expiresAt: new Date(Date.now() + 3_600_000) })
      .onConflictDoUpdate({ target: oauthTokens.userId, set: { accessTokenEnc: encrypt('fake-access-token', key), expiresAt: new Date(Date.now() + 3_600_000) } });
    let seenAuth = '';
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seenAuth = String((init?.headers as Record<string, string>).authorization);
      expect(url).toContain('/me/calendarView');
      return new Response(JSON.stringify({ value: [{ id: 'e1', subject: 'Reunião com cliente', start: { dateTime: '2026-10-24T13:00:00.0000000' }, end: { dateTime: '2026-10-24T14:00:00.0000000' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const graph = new GraphClient(graphApp.deps, graphApp.entra, fakeFetch);
    const events = await graph.calendarView(uid, new Date(), new Date(Date.now() + 86_400_000));
    expect(seenAuth).toBe('Bearer fake-access-token');
    expect(events[0]).toMatchObject({ subject: 'Reunião com cliente', start: '2026-10-24T13:00:00.0000000Z', joinUrl: expect.stringContaining('teams.microsoft.com') });
    const [st] = await graphApp.deps.db.select().from(integrationStatus).where(eq(integrationStatus.key, 'outlook_calendar'));
    expect(st!.state).toBe('healthy');
  });

  it('reports a refused token instead of pretending it worked', async () => {
    const uid = await userId(graphApp, 'bradesco1');
    const graph = new GraphClient(graphApp.deps, graphApp.entra, (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch);
    await expect(graph.calendarView(uid, new Date(), new Date(Date.now() + 1000))).rejects.toMatchObject({ code: 'graph_forbidden' });
    const [st] = await graphApp.deps.db.select().from(integrationStatus).where(eq(integrationStatus.key, 'outlook_calendar'));
    expect(st!.state).toBe('error');
  });

  it('tells users without a Microsoft session that the calendar is not connected', async () => {
    const ana = await login(graphApp, 'bradesco1');
    const r = await ana.get(`/integrations/calendar/events?from=${new Date().toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`);
    expect(r.json()).toMatchObject({ connected: false });
  });

  it('shows integrations as not configured in the admin panel when they are not', async () => {
    const admin = await login(built, 'platformAdmin');
    const items = (await admin.get('/admin/integrations')).json().items as { key: string; state: string }[];
    expect(items.find((i) => i.key === 'entra_id')!.state).toBe('not_configured');
    expect(items.find((i) => i.key === 'teams_meetings')!.state).toBe('not_configured');
    expect((await admin.post('/admin/integrations/storage/check')).json().state).toBe('healthy');
  });
});

describe('scheduled maintenance', () => {
  it('auto-closes old resolved tickets and warns the assignee before the SLA deadline', async () => {
    const db = built.deps.db;
    const [resolved] = await db.select().from(tickets).where(eq(tickets.statusKey, 'in_progress')).limit(1);
    await db.update(tickets).set({ statusKey: 'resolved', resolvedAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(tickets.id, resolved!.id));
    const [due] = await db.select().from(tickets).where(and(eq(tickets.statusKey, 'triage'), isNotNull(tickets.assigneeId))).limit(1);
    await db.update(tickets).set({ resolutionDueAt: new Date(Date.now() + 30 * 60_000), slaPolicyId: due!.slaPolicyId }).where(eq(tickets.id, due!.id));

    const runner = new BackgroundRunner(built.deps, built.mailer);
    await runner.tick();

    const [after] = await db.select().from(tickets).where(eq(tickets.id, resolved!.id));
    expect(after!.statusKey).toBe('closed');
    const warn = await db.select().from(notifications).where(and(eq(notifications.userId, due!.assigneeId!), eq(notifications.category, 'deadline'), eq(notifications.resourceId, due!.id)));
    expect(warn).toHaveLength(1);
    // Only once per ticket.
    await runner.tick();
    const again = await db.select().from(notifications).where(and(eq(notifications.category, 'deadline'), eq(notifications.resourceId, due!.id)));
    expect(again).toHaveLength(1);
  });
});
