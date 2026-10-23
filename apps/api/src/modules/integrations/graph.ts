import { eq } from 'drizzle-orm';
import type { EntraProvider } from '../../auth/entra.js';
import { integrationEvents, integrationStatus, oauthTokens } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError, unavailable } from '../../lib/errors.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string | null;
  joinUrl: string | null;
  webLink: string | null;
}

/**
 * Microsoft Graph with the user's delegated token (obtained at Entra login, stored encrypted).
 * Only the scopes listed in docs/INTEGRATIONS.md are requested. Nothing is copied or synchronised:
 * events are read on demand and shown, not stored.
 */
export class GraphClient {
  constructor(
    private readonly deps: Deps,
    private readonly entra: EntraProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async record(key: string, ok: boolean, message: string) {
    const { db } = this.deps;
    await db.insert(integrationEvents).values({ integrationKey: key, outcome: ok ? 'success' : 'failure', message: message.slice(0, 500) });
    const values = { state: ok ? ('healthy' as const) : ('error' as const), lastCheckedAt: new Date(), lastError: ok ? null : message.slice(0, 500) };
    await db.insert(integrationStatus).values({ key, ...values }).onConflictDoUpdate({ target: integrationStatus.key, set: values });
  }

  async accessToken(userId: string): Promise<string> {
    const { db, env } = this.deps;
    const key = env.TOKEN_ENCRYPTION_KEY;
    if (!key) throw unavailable('Integração com Microsoft 365 não configurada.');
    const [row] = await db.select().from(oauthTokens).where(eq(oauthTokens.userId, userId));
    if (!row) throw new AppError(409, 'graph_not_connected', 'Entre com sua conta Microsoft para conectar o Microsoft 365.');
    if (row.expiresAt.getTime() - Date.now() > 60_000) return decrypt(row.accessTokenEnc, key);
    if (!row.refreshTokenEnc) throw new AppError(409, 'graph_not_connected', 'A conexão com o Microsoft 365 expirou. Entre novamente com sua conta Microsoft.');
    try {
      const t = await this.entra.refresh(decrypt(row.refreshTokenEnc, key));
      const values = {
        accessTokenEnc: encrypt(t.access_token, key),
        refreshTokenEnc: t.refresh_token ? encrypt(t.refresh_token, key) : row.refreshTokenEnc,
        scopes: t.scope ?? row.scopes,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
      };
      await db.update(oauthTokens).set(values).where(eq(oauthTokens.userId, userId));
      return t.access_token;
    } catch (err) {
      // Revoked or expired consent: drop the stored token instead of retrying forever.
      await db.delete(oauthTokens).where(eq(oauthTokens.userId, userId));
      await this.record('microsoft_graph', false, `refresh_failed: ${(err as Error).message}`);
      throw new AppError(409, 'graph_not_connected', 'A conexão com o Microsoft 365 foi revogada. Entre novamente com sua conta Microsoft.');
    }
  }

  private async call<T>(userId: string, integration: string, path: string, init?: RequestInit): Promise<T> {
    const token = await this.accessToken(userId);
    let res: Response;
    try {
      res = await this.fetchImpl(`${GRAPH}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'outlook.timezone="UTC"', ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      await this.record(integration, false, `network: ${(err as Error).message}`);
      throw unavailable('O Microsoft 365 está indisponível no momento. Tente novamente mais tarde.');
    }
    if (res.status === 401 || res.status === 403) {
      await this.record(integration, false, `http_${res.status}`);
      throw new AppError(403, 'graph_forbidden', 'O Microsoft 365 recusou o acesso. Verifique o consentimento das permissões com a TI.');
    }
    if (!res.ok) {
      await this.record(integration, false, `http_${res.status}`);
      throw unavailable(`O Microsoft 365 respondeu com erro (${res.status}).`);
    }
    await this.record(integration, true, 'ok');
    return (await res.json()) as T;
  }

  async calendarView(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    if (!this.deps.env.GRAPH_CALENDAR_ENABLED) throw unavailable('A integração com o calendário do Outlook não está configurada.');
    const qs = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      $select: 'id,subject,start,end,location,onlineMeeting,webLink',
      $orderby: 'start/dateTime',
      $top: '50',
    });
    type GraphEvent = { id: string; subject?: string; start: { dateTime: string }; end: { dateTime: string }; location?: { displayName?: string }; onlineMeeting?: { joinUrl?: string } | null; webLink?: string };
    const data = await this.call<{ value: GraphEvent[] }>(userId, 'outlook_calendar', `/me/calendarView?${qs}`);
    return data.value.map((e) => ({
      id: e.id,
      subject: e.subject ?? '(sem assunto)',
      start: `${e.start.dateTime.replace(/Z?$/, '')}Z`,
      end: `${e.end.dateTime.replace(/Z?$/, '')}Z`,
      location: e.location?.displayName || null,
      joinUrl: e.onlineMeeting?.joinUrl ?? null,
      webLink: e.webLink ?? null,
    }));
  }

  async createOnlineMeeting(userId: string, input: { subject: string; start: Date; end: Date }): Promise<string> {
    const data = await this.call<{ joinWebUrl?: string }>(userId, 'teams_meetings', '/me/onlineMeetings', {
      method: 'POST',
      body: JSON.stringify({ subject: input.subject, startDateTime: input.start.toISOString(), endDateTime: input.end.toISOString() }),
    });
    if (!data.joinWebUrl) throw unavailable('O Microsoft Teams não retornou o link da reunião.');
    return data.joinWebUrl;
  }
}
