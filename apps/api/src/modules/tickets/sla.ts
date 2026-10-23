/**
 * Business-hours arithmetic for SLA deadlines.
 * Times are interpreted in the calendar's IANA time zone using Intl, without extra dependencies.
 */
export interface CalendarSpec {
  timezone: string;
  /** ISO weekday (0 = Sunday … 6 = Saturday) → list of ["HH:MM","HH:MM"] intervals. */
  workingHours: Record<string, [string, string][]>;
  /** Local dates (YYYY-MM-DD) without service. */
  holidays: Set<string>;
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parts(date: Date, tz: string) {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    hh: Number(out.hour),
    mm: Number(out.minute),
    ss: Number(out.second),
    weekday: WEEKDAYS[out.weekday!] ?? 0,
  };
}

/** Offset (ms) of the zone at the given instant: local wall-clock minus UTC. */
function offsetAt(date: Date, tz: string) {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC instant (handles DST transitions). */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - offsetAt(new Date(guess), tz);
  const second = guess - offsetAt(new Date(ts), tz);
  if (second !== ts) ts = second;
  return new Date(ts);
}

function localDate(date: Date, tz: string): LocalParts {
  const p = parts(date, tz);
  return { y: p.y, m: p.m, d: p.d, weekday: p.weekday };
}

const iso = (p: { y: number; m: number; d: number }) =>
  `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

function nextLocalDay(p: LocalParts): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const hm = (s: string) => s.split(':').map(Number) as [number, number];

/**
 * Adds `minutes` of service time to `start`. Returns null when the calendar has no working hours
 * at all (the SLA can't be computed — the UI must say so instead of inventing a deadline).
 */
export function addBusinessMinutes(start: Date, minutes: number, cal: CalendarSpec): Date | null {
  const hasHours = Object.values(cal.workingHours).some((v) => v.length > 0);
  if (!hasHours) return null;
  let cursor = start;
  let remaining = minutes;
  for (let guard = 0; guard < 800; guard++) {
    const day = localDate(cursor, cal.timezone);
    const intervals = cal.holidays.has(iso(day)) ? [] : cal.workingHours[String(day.weekday)] ?? [];
    for (const [s, e] of intervals) {
      const [sh, sm] = hm(s);
      const [eh, em] = hm(e);
      const iStart = zonedTimeToUtc(day.y, day.m, day.d, sh, sm, cal.timezone);
      const iEnd = zonedTimeToUtc(day.y, day.m, day.d, eh, em, cal.timezone);
      if (cursor >= iEnd) continue;
      const from = cursor > iStart ? cursor : iStart;
      const available = (iEnd.getTime() - from.getTime()) / 60_000;
      if (remaining <= available) return new Date(from.getTime() + remaining * 60_000);
      remaining -= available;
      cursor = iEnd;
    }
    const n = nextLocalDay(day);
    cursor = zonedTimeToUtc(n.y, n.m, n.d, 0, 0, cal.timezone);
  }
  return null;
}

export type SlaState = 'not_configured' | 'on_track' | 'at_risk' | 'breached' | 'met' | 'missed';

/** State of the resolution SLA for display. `at_risk` = less than 20% of the window left. */
export function slaState(t: {
  slaPolicyId: string | null;
  createdAt: Date;
  resolutionDueAt: Date | null;
  resolvedAt: Date | null;
}, now = new Date()): SlaState {
  if (!t.slaPolicyId || !t.resolutionDueAt) return 'not_configured';
  if (t.resolvedAt) return t.resolvedAt <= t.resolutionDueAt ? 'met' : 'missed';
  if (now > t.resolutionDueAt) return 'breached';
  const total = t.resolutionDueAt.getTime() - t.createdAt.getTime();
  const left = t.resolutionDueAt.getTime() - now.getTime();
  return total > 0 && left / total < 0.2 ? 'at_risk' : 'on_track';
}
