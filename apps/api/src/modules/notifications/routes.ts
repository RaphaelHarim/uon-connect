import { idParam, notificationListQuery } from '@uon/shared';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { notifications } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { notFound } from '../../lib/errors.js';
import { requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { unreadCount } from './service.js';

export function registerNotificationRoutes(app: App, deps: Deps) {
  const { db } = deps;

  app.get('/notifications', { schema: { querystring: notificationListQuery } }, async (req) => {
    const ctx = requireAuth(req);
    const q = req.query;
    const rows = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, ctx.userId),
        q.unreadOnly ? isNull(notifications.readAt) : undefined,
        q.category ? eq(notifications.category, q.category) : undefined,
        q.before ? lt(notifications.updatedAt, new Date(q.before)) : undefined,
      ))
      .orderBy(desc(notifications.updatedAt))
      .limit(q.limit + 1);
    return { items: rows.slice(0, q.limit), hasMore: rows.length > q.limit, unread: await unreadCount(deps, ctx.userId) };
  });

  app.get('/notifications/unread-count', async (req) => ({ unread: await unreadCount(deps, requireAuth(req).userId) }));

  app.post('/notifications/:id/read', { schema: { params: idParam } }, async (req) => {
    const ctx = requireAuth(req);
    const [row] = await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, req.params.id), eq(notifications.userId, ctx.userId))).returning({ id: notifications.id });
    if (!row) throw notFound();
    return { ok: true, unread: await unreadCount(deps, ctx.userId) };
  });

  app.post('/notifications/read-all', async (req) => {
    const ctx = requireAuth(req);
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
    return { ok: true, unread: 0 };
  });
}
