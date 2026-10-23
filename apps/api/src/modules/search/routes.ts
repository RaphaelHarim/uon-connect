import { globalSearchQuery } from '@uon/shared';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { users } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { toUserSummary } from '../../lib/users.js';
import { listConversations, searchMessages } from '../chat/service.js';
import { listTickets } from '../tickets/service.js';

/** Global search. Each section reuses the module's own authorisation, so results never exceed what the user may open. */
export function registerSearchRoutes(app: App, deps: Deps) {
  app.get('/search', { schema: { querystring: globalSearchQuery } }, async (req) => {
    const ctx = requireAuth(req);
    const q = req.query.q;
    const term = q.replace(/[%_\\]/g, (m) => `\\${m}`);
    const [tix, people, convs, msgs] = await Promise.all([
      listTickets(deps, ctx, { q, view: 'all', page: 1, pageSize: 6, sort: 'updated_desc' }),
      deps.db.select().from(users)
        .where(and(eq(users.status, 'active'), or(ilike(users.displayName, `%${term}%`), ilike(users.email, `%${term}%`))))
        .orderBy(asc(users.displayName)).limit(6),
      listConversations(deps, ctx),
      q.length >= 3 ? searchMessages(deps, ctx, q, undefined, 6) : Promise.resolve([]),
    ]);
    const lower = q.toLowerCase();
    return {
      tickets: tix.items.map((t) => ({ id: t.id, protocol: t.protocol, title: t.title, status: t.status })),
      people: people.map(toUserSummary),
      conversations: convs.filter((c) => (c.name ?? '').toLowerCase().includes(lower)).slice(0, 6).map((c) => ({ id: c.id, name: c.name, type: c.type })),
      messages: msgs,
    };
  });
}
