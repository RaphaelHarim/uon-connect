/** Start of the given ISO date (YYYY-MM-DD) in UTC, or undefined. */
export const dayStart = (d?: string) => (d ? new Date(`${d}T00:00:00.000Z`) : undefined);
/** Exclusive end: start of the following day. */
export const dayEnd = (d?: string) => {
  if (!d) return undefined;
  const x = new Date(`${d}T00:00:00.000Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
};
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
