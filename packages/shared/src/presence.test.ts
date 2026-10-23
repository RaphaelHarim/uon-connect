import { describe, expect, it } from 'vitest';
import { computePresence } from './presence.js';

const base = { connected: true, idle: false, manualStatus: null, manualExpiresAt: null, absenceActive: false };

describe('computePresence', () => {
  it('derives available only from an active, non-idle connection', () => {
    expect(computePresence(base)).toEqual({ status: 'available', source: 'automatic', connected: true });
    expect(computePresence({ ...base, idle: true }).status).toBe('away');
    expect(computePresence({ ...base, connected: false }).status).toBe('offline');
  });
  it('honours a manual status until it expires', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const later = new Date('2026-01-01T13:00:00Z');
    const earlier = new Date('2026-01-01T11:00:00Z');
    expect(computePresence({ ...base, manualStatus: 'dnd', manualExpiresAt: later, now }).status).toBe('dnd');
    expect(computePresence({ ...base, manualStatus: 'dnd', manualExpiresAt: earlier, now }).source).toBe('automatic');
  });
  it('lets an active absence override everything', () => {
    expect(computePresence({ ...base, manualStatus: 'available', absenceActive: true })).toEqual({
      status: 'away',
      source: 'absence',
      connected: true,
    });
  });
});
