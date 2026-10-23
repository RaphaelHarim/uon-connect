import { settingsBody } from '@uon/shared';
import { desc, sql } from 'drizzle-orm';
import { requirePermission } from '../../authz/context.js';
import { jobs } from '../../db/schema/index.js';
import type { Deps } from '../../deps.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import type { Extras } from '../../routes.js';
import { recordAudit } from '../audit/service.js';
import { getSettings, setSettings } from '../settings/service.js';

export function registerAdminRoutes(app: App, deps: Deps, _extras: Extras) {
  const { db } = deps;

  app.get('/admin/settings', async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'settings.manage');
    return getSettings(db);
  });

  app.put('/admin/settings', { schema: { body: settingsBody } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'settings.manage');
    const before = await getSettings(db);
    await setSettings(db, req.body, ctx.userId);
    await recordAudit(db, { actor: ctx, action: 'settings.updated', resourceType: 'settings', outcome: 'success', metadata: { before, after: req.body }, meta: reqMeta(req) });
    return getSettings(db);
  });

  app.get('/admin/jobs', async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'admin.dashboard');
    const [summary, recent] = await Promise.all([
      db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status),
      db.select({ id: jobs.id, type: jobs.type, status: jobs.status, attempts: jobs.attempts, lastError: jobs.lastError, runAt: jobs.runAt, createdAt: jobs.createdAt, finishedAt: jobs.finishedAt })
        .from(jobs).orderBy(desc(jobs.id)).limit(50),
    ]);
    return { summary, recent };
  });
}
