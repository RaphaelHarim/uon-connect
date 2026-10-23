import type { Tx } from '../../db/client.js';
import { auditEvents } from '../../db/schema/index.js';
import type { AuthContext } from '../../authz/context.js';

export interface RequestMeta {
  correlationId?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditInput {
  actor?: Pick<AuthContext, 'userId' | 'user'> | null;
  actorLabel?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: 'success' | 'denied' | 'failure';
  /** Minimal context for investigation. Never put secrets, tokens or private content here. */
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

const FORBIDDEN_KEYS = /pass(word)?|secret|token|authorization|cookie|body|content/i;

function scrub(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = FORBIDDEN_KEYS.test(k) ? '[omitido]' : v;
  return out;
}

export async function recordAudit(db: Tx, e: AuditInput) {
  await db.insert(auditEvents).values({
    actorUserId: e.actor?.userId ?? null,
    actorLabel: e.actorLabel ?? e.actor?.user.email ?? null,
    action: e.action,
    resourceType: e.resourceType ?? null,
    resourceId: e.resourceId ?? null,
    outcome: e.outcome,
    correlationId: e.meta?.correlationId ?? null,
    ip: e.meta?.ip ?? null,
    userAgent: e.meta?.userAgent?.slice(0, 300) ?? null,
    metadata: scrub(e.metadata) ?? null,
  });
}
