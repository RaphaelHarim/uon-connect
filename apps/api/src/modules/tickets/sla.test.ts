import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, slaState, zonedTimeToUtc } from './sla.js';

const weekdays: Record<string, [string, string][]> = {
  '1': [['09:00', '12:00'], ['13:00', '18:00']],
  '2': [['09:00', '12:00'], ['13:00', '18:00']],
  '3': [['09:00', '12:00'], ['13:00', '18:00']],
  '4': [['09:00', '12:00'], ['13:00', '18:00']],
  '5': [['09:00', '12:00'], ['13:00', '18:00']],
};
const cal = { timezone: 'America/Sao_Paulo', workingHours: weekdays, holidays: new Set<string>() };

describe('zonedTimeToUtc', () => {
  it('converts São Paulo wall-clock time (UTC-3) to UTC', () => {
    expect(zonedTimeToUtc(2026, 3, 2, 9, 0, 'America/Sao_Paulo').toISOString()).toBe('2026-03-02T12:00:00.000Z');
  });
});

describe('addBusinessMinutes', () => {
  it('adds within the same interval', () => {
    const start = zonedTimeToUtc(2026, 3, 2, 9, 30, cal.timezone); // Monday
    expect(addBusinessMinutes(start, 60, cal)?.toISOString()).toBe(zonedTimeToUtc(2026, 3, 2, 10, 30, cal.timezone).toISOString());
  });
  it('skips the lunch break', () => {
    const start = zonedTimeToUtc(2026, 3, 2, 11, 30, cal.timezone);
    expect(addBusinessMinutes(start, 60, cal)?.toISOString()).toBe(zonedTimeToUtc(2026, 3, 2, 13, 30, cal.timezone).toISOString());
  });
  it('starts counting at opening time when created out of hours', () => {
    const start = zonedTimeToUtc(2026, 3, 2, 6, 0, cal.timezone);
    expect(addBusinessMinutes(start, 30, cal)?.toISOString()).toBe(zonedTimeToUtc(2026, 3, 2, 9, 30, cal.timezone).toISOString());
  });
  it('rolls over the weekend', () => {
    const start = zonedTimeToUtc(2026, 3, 6, 17, 0, cal.timezone); // Friday 17:00
    expect(addBusinessMinutes(start, 120, cal)?.toISOString()).toBe(zonedTimeToUtc(2026, 3, 9, 10, 0, cal.timezone).toISOString());
  });
  it('skips holidays', () => {
    const withHoliday = { ...cal, holidays: new Set(['2026-03-09']) };
    const start = zonedTimeToUtc(2026, 3, 6, 17, 0, cal.timezone);
    expect(addBusinessMinutes(start, 120, withHoliday)?.toISOString()).toBe(zonedTimeToUtc(2026, 3, 10, 10, 0, cal.timezone).toISOString());
  });
  it('returns null for a calendar without working hours', () => {
    expect(addBusinessMinutes(new Date(), 10, { ...cal, workingHours: {} })).toBeNull();
  });
});

describe('slaState', () => {
  const created = new Date('2026-03-02T12:00:00Z');
  const due = new Date('2026-03-02T22:00:00Z');
  it('is not_configured without a policy', () => {
    expect(slaState({ slaPolicyId: null, createdAt: created, resolutionDueAt: null, resolvedAt: null })).toBe('not_configured');
  });
  it('tracks open tickets', () => {
    const t = { slaPolicyId: 'x', createdAt: created, resolutionDueAt: due, resolvedAt: null };
    expect(slaState(t, new Date('2026-03-02T13:00:00Z'))).toBe('on_track');
    expect(slaState(t, new Date('2026-03-02T21:00:00Z'))).toBe('at_risk');
    expect(slaState(t, new Date('2026-03-02T23:00:00Z'))).toBe('breached');
  });
  it('classifies resolved tickets', () => {
    expect(slaState({ slaPolicyId: 'x', createdAt: created, resolutionDueAt: due, resolvedAt: new Date('2026-03-02T20:00:00Z') })).toBe('met');
    expect(slaState({ slaPolicyId: 'x', createdAt: created, resolutionDueAt: due, resolvedAt: new Date('2026-03-03T20:00:00Z') })).toBe('missed');
  });
});
