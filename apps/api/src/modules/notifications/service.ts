import { DEFAULT_NOTIFICATION_PREFS, type NotificationCategory } from '@uon/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Deps } from '../../deps.js';
import { notifications, userPreferences, users } from '../../db/schema/index.js';
import { enqueueJob } from '../../jobs/queue.js';

export interface NotifyInput {
  userIds: Iterable<string>;
  /** The person who caused the event never gets notified about it. */
  excludeUserId?: string;
  category: NotificationCategory;
  /** Must not contain confidential content: titles appear in e-mails and lock screens. */
  title: string;
  /** In-app only, never e-mailed. */
  body?: string | null;
  link?: string;
  resourceType?: string;
  resourceId?: string;
  dedupeKey?: string;
}

export async function notify(deps: Deps, input: NotifyInput) {
  const targets = [...new Set(input.userIds)].filter((u) => u !== input.excludeUserId);
  if (targets.length === 0) return;
  const { db, realtime, env } = deps;

  const rows = await db
    .select({ id: users.id, status: users.status, prefs: userPreferences.notifications })
    .from(users)
    .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(inArray(users.id, targets));

  for (const u of rows) {
    if (u.status !== 'active') continue;
    const pref = u.prefs?.[input.category] ?? DEFAULT_NOTIFICATION_PREFS[input.category];
    if (!pref.inApp && !pref.email) continue;

    const values = {
      userId: u.id,
      category: input.category,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      // Hidden from the inbox when the user disabled in-app notifications for this category.
      readAt: pref.inApp ? null : new Date(),
    };
    const [saved] = input.dedupeKey && pref.inApp
      ? await db
          .insert(notifications)
          .values(values)
          .onConflictDoUpdate({
            target: [notifications.userId, notifications.dedupeKey],
            targetWhere: isNull(notifications.readAt),
            set: {
              count: sql`${notifications.count} + 1`,
              title: values.title,
              body: values.body,
              link: values.link,
              updatedAt: new Date(),
            },
          })
          .returning()
      : await db.insert(notifications).values(values).returning();

    if (saved && pref.inApp) realtime.toUsers([u.id], 'notification:new', saved);
    if (saved && pref.email && (env.emailConfigured || env.NODE_ENV === 'test')) {
      await enqueueJob(db, 'email.notification', { notificationId: saved.id });
    }
  }
}

export async function unreadCount(deps: Deps, userId: string) {
  const [r] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}
