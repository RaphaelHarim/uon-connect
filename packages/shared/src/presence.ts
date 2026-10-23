import type { PresenceStatus } from './constants.js';

export interface PresenceInputs {
  /** True if the user has at least one live realtime connection. */
  connected: boolean;
  /** Whether the connected client reported recent activity. */
  idle: boolean;
  manualStatus: PresenceStatus | null;
  manualExpiresAt: Date | null;
  absenceActive: boolean;
  now?: Date;
}

export interface EffectivePresence {
  status: PresenceStatus;
  /** Where the status comes from — the UI must make this distinction visible. */
  source: 'absence' | 'manual' | 'automatic';
  connected: boolean;
}

/**
 * Computes the status shown to colleagues.
 * A scheduled absence wins; then a manual status that has not expired; otherwise the status is
 * derived from the connection only. A connected session never implies that someone is working.
 */
export function computePresence(input: PresenceInputs): EffectivePresence {
  const now = input.now ?? new Date();
  if (input.absenceActive) return { status: 'away', source: 'absence', connected: input.connected };
  const manualValid =
    input.manualStatus !== null && (input.manualExpiresAt === null || input.manualExpiresAt > now);
  if (manualValid) {
    // "offline" as a manual status means "appear offline".
    return { status: input.manualStatus!, source: 'manual', connected: input.connected };
  }
  if (!input.connected) return { status: 'offline', source: 'automatic', connected: false };
  return { status: input.idle ? 'away' : 'available', source: 'automatic', connected: true };
}
