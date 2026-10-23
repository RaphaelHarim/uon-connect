import { Table2, BarChart3 } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

/**
 * Lightweight SVG charts (no chart library: small bundle, full control of accessibility).
 * Every chart has an accessible name, a hover/focus tooltip, and a "table" view with the same data.
 */

export function ChartFrame({
  title,
  description,
  definition,
  table,
  children,
}: {
  title: string;
  description?: string;
  definition?: string;
  table: { columns: string[]; rows: (string | number | null)[][] };
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="rounded-xl border border-line bg-surface shadow-card">
      <figcaption className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{title}</p>
          {description && <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>}
        </div>
        <button
          onClick={() => setAsTable((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-2 hover:bg-surface-2"
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
          {asTable ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </figcaption>
      <div className="px-5 py-4">
        {asTable ? (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-fg-3">
                  {table.columns.map((c, i) => (
                    <th key={c} className={cn('pb-2 font-medium', i > 0 && 'text-right')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {r.map((cell, j) => (
                      <td key={j} className={cn('py-1.5', j > 0 && 'text-right tabular-nums')}>
                        {typeof cell === 'number' ? formatNumber(cell) : cell ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
        {definition && <p className="mt-3 text-xs text-fg-3">{definition}</p>}
      </div>
    </figure>
  );
}

/** Horizontal labelled bars: identity comes from the label, so a single hue is enough. */
export function BarList({ data, valueLabel = 'Chamados', emptyText = 'Sem dados no período.' }: { data: { label: string; value: number; hint?: string }[]; valueLabel?: string; emptyText?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0 || data.every((d) => d.value === 0)) return <p className="py-6 text-center text-[13px] text-fg-3">{emptyText}</p>;
  return (
    <ul className="space-y-2.5" aria-label={valueLabel}>
      {data.map((d) => (
        <li key={d.label} className="group" title={`${d.label}: ${formatNumber(d.value)}${d.hint ? ` · ${d.hint}` : ''}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-fg-2">{d.label}</span>
            <span className="font-semibold tabular-nums text-fg">
              {formatNumber(d.value)}
              {d.hint && <span className="ml-1.5 font-normal text-fg-3">{d.hint}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div className="chart-bar h-2 rounded-full bg-[var(--bar)] transition-[width] duration-500 group-hover:opacity-85" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Charts render at their container's real pixel width, so text never scales with the layout. */
function useWidth(ref: RefObject<HTMLDivElement | null>, fallback = 600) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Vertical columns for a single series over time (e.g. tickets per week). */
export function ColumnChart({ data, height = 180, valueLabel = 'Chamados' }: { data: { label: string; value: number }[]; height?: number; valueLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box);
  if (data.length === 0) return <p className="py-6 text-center text-[13px] text-fg-3">Sem dados no período.</p>;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const pad = { l: 32, r: 8, t: 10, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const slot = innerW / data.length;
  const bw = Math.max(4, Math.min(36, slot - 6));
  const ticks = [0, max / 2, max];
  return (
    <div className="relative" ref={box}>
      <svg width={W} height={height} className="block" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{`${valueLabel}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}</title>
        {ticks.map((t) => {
          const y = pad.t + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--grid)" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--text-3)">
                {formatNumber(Math.round(t))}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = pad.l + i * slot + (slot - bw) / 2;
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label}: ${d.value}`}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={innerH} fill="transparent" />
              {h > 0 && <path className="chart-bar" d={`M${x},${pad.t + innerH} v${-(h - r)} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`} fill="var(--bar)" opacity={hover === null || hover === i ? 1 : 0.55} />}
              {i % Math.max(1, Math.ceil(data.length / Math.floor(innerW / 48))) === 0 && (
                <text x={pad.l + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--text-3)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop" style={{ left: Math.min(Math.max(0, pad.l + hover * slot + slot / 2 - 50), W - 120) }}>
          <p className="text-fg-3">{data[hover].label}</p>
          <p className="font-semibold tabular-nums">
            {formatNumber(data[hover].value)} {valueLabel.toLowerCase()}
          </p>
        </div>
      )}
    </div>
  );
}

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

/** Multi-series line chart (≤ 3 series by design; more fold into a table). Legend + direct labels. */
export function LineChart({ series, labels, height = 220 }: { series: { name: string; values: number[] }[]; labels: string[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const shown = series.slice(0, 3);
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 640);
  const max = niceMax(Math.max(1, ...shown.flatMap((s) => s.values)));
  const pad = { l: 34, r: 96, t: 12, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const paths = useMemo(() => shown.map((s) => s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')), [shown, labels.length, max, W]); // eslint-disable-line react-hooks/exhaustive-deps
  // Direct labels at the line ends, nudged apart so they never overlap (min 14px).
  const endLabels = useMemo(() => {
    const items = shown.map((s, i) => ({ i, y: y(s.values.at(-1) ?? 0) })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < items.length; k++) if (items[k]!.y - items[k - 1]!.y < 14) items[k]!.y = items[k - 1]!.y + 14;
    return new Map(items.map((it) => [it.i, it.y]));
  }, [shown, max, W]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!labels.length || !shown.length) return <p className="py-6 text-center text-[13px] text-fg-3">Sem dados no período.</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-fg-2" aria-hidden>
        {shown.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: SERIES[i] }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="relative" ref={box}>
        <svg width={W} height={height} className="block" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setHover(null)}>
          <title id={`${id}-t`}>{shown.map((s) => `${s.name}: ${s.values.join(', ')}`).join('; ')}</title>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-3)">
                {formatNumber(Math.round(t))}
              </text>
            </g>
          ))}
          {labels.map((l, i) => (
            <g key={l}>
              <rect x={x(i) - innerW / Math.max(1, labels.length - 1) / 2} y={pad.t} width={innerW / Math.max(1, labels.length - 1)} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
              {(labels.length <= 12 || i % 2 === 0) && (
                <text x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--text-3)">
                  {l}
                </text>
              )}
            </g>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke="var(--border-strong)" strokeDasharray="3 3" />}
          {shown.map((s, si) => (
            <g key={s.name}>
              <path d={paths[si]} fill="none" stroke={SERIES[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4.5" fill={SERIES[si]} stroke="var(--surface)" strokeWidth="2" />}
              <text x={x(labels.length - 1) + 8} y={(endLabels.get(si) ?? 0) + 4} fontSize="11" fill="var(--text-2)">
                {s.name}
              </text>
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop" style={{ left: Math.min(x(hover) + 8, W - 160) }}>
            <p className="mb-1 text-fg-3">{labels[hover]}</p>
            {shown.map((s, si) => (
              <p key={s.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: SERIES[si] }} />
                <span className="text-fg-2">{s.name}</span>
                <span className="ml-auto pl-3 font-semibold tabular-nums">{formatNumber(s.values[hover] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {series.length > 3 && <p className="mt-2 text-xs text-fg-3">Exibindo 3 de {series.length} séries; as demais estão na tabela.</p>}
    </div>
  );
}
