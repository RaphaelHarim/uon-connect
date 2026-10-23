import type { EntraProvider } from './auth/entra.js';
import type { Deps } from './deps.js';
import type { Mailer } from './jobs/mailer.js';
import type { App } from './lib/types.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerChatRoutes } from './modules/chat/routes.js';
import { registerDashboardRoutes } from './modules/dashboards/routes.js';
import { registerFileRoutes } from './modules/files/routes.js';
import { registerIntegrationRoutes } from './modules/integrations/routes.js';
import { registerMeRoutes } from './modules/me/routes.js';
import { registerMeetingRoutes } from './modules/meetings/routes.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { registerOrgRoutes } from './modules/org/routes.js';
import { registerPresenceRoutes } from './modules/presence/routes.js';
import { registerSearchRoutes } from './modules/search/routes.js';
import { registerTicketConfigRoutes } from './modules/tickets/config-routes.js';
import { registerTicketRoutes } from './modules/tickets/routes.js';
import { registerUserAdminRoutes } from './modules/users/routes.js';

export interface Extras {
  mailer: Mailer;
  entra: EntraProvider;
}

export function registerRoutes(app: App, deps: Deps, extras: Extras) {
  registerAuthRoutes(app, deps, extras.entra);
  registerMeRoutes(app, deps, extras);
  registerOrgRoutes(app, deps);
  registerUserAdminRoutes(app, deps);
  registerTicketConfigRoutes(app, deps);
  registerTicketRoutes(app, deps);
  registerDashboardRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerFileRoutes(app, deps);
  registerPresenceRoutes(app, deps);
  registerMeetingRoutes(app, deps, extras);
  registerNotificationRoutes(app, deps);
  registerSearchRoutes(app, deps);
  registerAuditRoutes(app, deps);
  registerAdminRoutes(app, deps, extras);
  registerIntegrationRoutes(app, deps, extras);
}
