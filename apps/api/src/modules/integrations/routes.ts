import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '../../authz/context.js';
import { integrationEvents, integrationStatus } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { badRequest } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import type { Extras } from '../../routes.js';
import { recordAudit } from '../audit/service.js';
import { GraphClient } from './graph.js';

const KEYS = ['entra_id', 'outlook_calendar', 'teams_meetings', 'email', 'storage', 'turn'] as const;
type Key = (typeof KEYS)[number];

export function registerIntegrationRoutes(app: App, deps: Deps, extras: Extras) {
  const { db, env } = deps;
  const graph = new GraphClient(deps, extras.entra);

  const configured: Record<Key, boolean> = {
    entra_id: env.entraEnabled,
    outlook_calendar: env.GRAPH_CALENDAR_ENABLED,
    teams_meetings: env.GRAPH_TEAMS_MEETINGS_ENABLED,
    email: env.emailConfigured,
    storage: true,
    turn: env.TURN_URLS.length > 0,
  };
  const descriptions: Record<Key, string> = {
    entra_id: 'Login corporativo (OpenID Connect).',
    outlook_calendar: 'Leitura do calendário do Outlook do próprio usuário (Calendars.Read, delegado).',
    teams_meetings: 'Criação de reuniões online no Teams (OnlineMeetings.ReadWrite, delegado).',
    email: 'Envio de notificações por e-mail (SMTP).',
    storage: `Armazenamento privado de arquivos (driver: ${env.STORAGE_DRIVER}).`,
    turn: 'Servidor TURN para chamadas de vídeo atravessarem NAT/firewall.',
  };

  async function check(key: Key): Promise<{ ok: boolean; detail: string }> {
    if (!configured[key]) return { ok: false, detail: 'not_configured' };
    switch (key) {
      case 'entra_id':
        try {
          await extras.entra.getConfig();
          return { ok: true, detail: 'discovery_ok' };
        } catch (err) {
          return { ok: false, detail: (err as Error).message };
        }
      case 'email': {
        const r = await extras.mailer.verify();
        return { ok: r.ok, detail: r.detail ?? 'smtp_ok' };
      }
      case 'storage': {
        const r = await deps.storage.health();
        return { ok: r.ok, detail: r.detail ?? 'ok' };
      }
      default:
        // Delegated integrations can only be verified with a signed-in user's token (see last events).
        return { ok: true, detail: 'configured_only' };
    }
  }

  app.get('/admin/integrations', async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'integrations.read');
    const statuses = await db.select().from(integrationStatus);
    const events = await db.select().from(integrationEvents).orderBy(desc(integrationEvents.id)).limit(30);
    return {
      items: KEYS.map((key) => {
        const s = statuses.find((x) => x.key === key);
        return {
          key,
          description: descriptions[key],
          configured: configured[key],
          state: !configured[key] ? 'not_configured' : s?.state ?? 'configured',
          lastCheckedAt: s?.lastCheckedAt ?? null,
          lastError: s?.lastError ?? null,
        };
      }),
      events,
    };
  });

  app.post('/admin/integrations/:key/check', { schema: { params: z.object({ key: z.enum(KEYS) }) } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'integrations.read');
    const key = req.params.key;
    const r = await check(key);
    const state = !configured[key] ? 'not_configured' : r.detail === 'configured_only' ? 'configured' : r.ok ? 'healthy' : 'error';
    const values = { state: state as 'healthy', lastCheckedAt: new Date(), lastError: r.ok ? null : r.detail };
    await db.insert(integrationStatus).values({ key, ...values }).onConflictDoUpdate({ target: integrationStatus.key, set: values });
    if (configured[key]) await db.insert(integrationEvents).values({ integrationKey: key, outcome: r.ok ? 'success' : 'failure', message: `manual_check: ${r.detail}` });
    await recordAudit(db, { actor: ctx, action: 'integration.checked', resourceType: 'integration', resourceId: key, outcome: r.ok ? 'success' : 'failure', meta: reqMeta(req) });
    return { key, state, detail: r.detail };
  });

  /** The signed-in user's own Outlook events (read on demand, never stored). */
  app.get('/integrations/calendar/events', { schema: { querystring: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }) } }, async (req) => {
    const ctx = requireAuth(req);
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    if (to <= from || to.getTime() - from.getTime() > 62 * 86_400_000) throw badRequest('Intervalo inválido (máximo de 62 dias).');
    if (ctx.authMethod !== 'entra') return { connected: false, reason: 'Entre com sua conta Microsoft para ver seu calendário.', events: [] };
    return { connected: true, events: await graph.calendarView(ctx.userId, from, to) };
  });

  app.get('/integrations/status', async (req) => {
    requireAuth(req);
    const rows = await db.select().from(integrationStatus).where(eq(integrationStatus.key, 'outlook_calendar'));
    return { outlookCalendar: { configured: env.GRAPH_CALENDAR_ENABLED, state: rows[0]?.state ?? null }, teamsMeetings: { configured: env.GRAPH_TEAMS_MEETINGS_ENABLED } };
  });
}
