const dtf = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });
const tf = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const nf = new Intl.NumberFormat('pt-BR');

const toDate = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);

export const formatDateTime = (v?: string | Date | null) => (v ? dtf.format(toDate(v)) : '—');
export const formatDate = (v?: string | Date | null) => (v ? df.format(toDate(v)) : '—');
export const formatTime = (v?: string | Date | null) => (v ? tf.format(toDate(v)) : '');
export const formatNumber = (n?: number | null) => (n === null || n === undefined ? '—' : nf.format(n));

export function formatRelative(v?: string | Date | null) {
  if (!v) return '—';
  const diff = (toDate(v).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'agora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return formatDate(v);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function formatHours(h?: number | null) {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1).replace('.', ',')} h`;
  return `${(h / 24).toFixed(1).replace('.', ',')} dias`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));
