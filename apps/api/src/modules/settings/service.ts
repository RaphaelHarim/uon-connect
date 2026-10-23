import { eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { systemSettings } from '../../db/schema/index.js';

export interface PlatformSettings {
  /** Who may start a direct conversation with whom. */
  chatDirectPolicy: 'company' | 'department';
  /** Who may create group conversations. */
  chatGroupCreation: 'everyone' | 'leaders';
  /** Days after closing during which the requester may still reopen a ticket. */
  ticketReopenWindowDays: number;
  /** Resolved tickets close automatically after this many days without reaction (0 = never). */
  ticketAutoCloseResolvedDays: number;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  chatDirectPolicy: 'company',
  chatGroupCreation: 'everyone',
  ticketReopenWindowDays: 7,
  ticketAutoCloseResolvedDays: 5,
};

export async function getSettings(db: Tx): Promise<PlatformSettings> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, Object.keys(DEFAULT_SETTINGS)));
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as PlatformSettings;
}

export async function setSettings(db: Tx, patch: Partial<PlatformSettings>, userId: string) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db
      .insert(systemSettings)
      .values({ key, value, updatedBy: userId })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedBy: userId } });
  }
}

export async function getSetting<K extends keyof PlatformSettings>(db: Tx, key: K): Promise<PlatformSettings[K]> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return (row?.value as PlatformSettings[K]) ?? DEFAULT_SETTINGS[key];
}
