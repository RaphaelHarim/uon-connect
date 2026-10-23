import { TICKET_STATUS_KEYS } from '@uon/shared/browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, ColorBadge, Dialog, Field, Input, Notice, Select, Spinner, Switch, Tabs } from '@/components/ui';
import { api, get, post, put } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { OrgStructure } from '../Org';
import { AdminPage } from './common';

interface Config {
  categories: { id: string; name: string; description: string | null; serviceDepartmentId: string | null; defaultConfidential: boolean; active: boolean; sortOrder: number }[];
  priorities: { key: string; label: string; rank: number; color: string; active: boolean }[];
  statuses: { key: string; label: string; kind: string; color: string; sortOrder: number }[];
  transitions: { fromStatus: string; toStatus: string; actor: 'requester' | 'handler'; requiresReason: boolean }[];
  calendars: { id: string; name: string; timezone: string; workingHours: Record<string, [string, string][]> }[];
  holidays: { id: string; calendarId: string; date: string; name: string }[];
  slaPolicies: { id: string; name: string; priorityKey: string; categoryId: string | null; calendarId: string; firstResponseMinutes: number; resolutionMinutes: number; active: boolean }[];
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function AdminTicketConfig() {
  const [tab, setTab] = useState('categorias');
  const q = useQuery({ queryKey: ['admin', 'ticket-config'], queryFn: () => get<Config>('/admin/ticket-config') });
  const org = useQuery({ queryKey: ['org'], queryFn: () => get<OrgStructure>('/org/structure') });
  const qc = useQueryClient();
  const toast = useToast();
  const run = (p: Promise<unknown>, ok = 'Configuração salva') => p.then(() => { void qc.invalidateQueries({ queryKey: ['admin', 'ticket-config'] }); void qc.invalidateQueries({ queryKey: ['tickets'] }); toast.success(ok); }).catch((e) => toast.error('Não foi possível salvar', e));
  const [cat, setCat] = useState<null | (Partial<Config['categories'][number]>)>(null);
  const [sla, setSla] = useState<null | Partial<Config['slaPolicies'][number]>>(null);
  const [holiday, setHoliday] = useState({ date: '', name: '' });

  if (!q.data) return <Spinner />;
  const c = q.data;
  const desks = org.data?.departments.filter((d) => d.acceptsTickets) ?? [];
  const has = (f: string, t: string, a: string) => c.transitions.find((x) => x.fromStatus === f && x.toStatus === t && x.actor === a);
  const cal = c.calendars[0];

  return (
    <AdminPage permission="tickets.config.manage" title="Configuração de chamados" description="Categorias, prioridades, fluxo de status e SLA.">
      <Tabs value={tab} onValueChange={setTab} items={[{ value: 'categorias', label: 'Categorias' }, { value: 'prioridades', label: 'Prioridades e status' }, { value: 'fluxo', label: 'Fluxo de status' }, { value: 'sla', label: 'Calendário e SLA' }]} />

      {tab === 'categorias' && (
        <Card>
          <CardHeader title="Categorias" description="Categorias vinculadas a uma central são sempre encaminhadas a ela." actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setCat({ name: '', description: '', serviceDepartmentId: null, defaultConfidential: false, active: true, sortOrder: 100 })}>Nova categoria</Button>} />
          <ul className="divide-y divide-line">
            {c.categories.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[13px]">
                <span className="font-medium">{x.name}</span>
                {x.serviceDepartmentId && <Badge tone="info">→ {org.data?.departments.find((d) => d.id === x.serviceDepartmentId)?.name}</Badge>}
                {x.defaultConfidential && <Badge>Confidencial por padrão</Badge>}
                {!x.active && <Badge tone="danger">Inativa</Badge>}
                <span className="truncate text-fg-3">{x.description}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setCat(x)}>Editar</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'prioridades' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Prioridades" />
            <ul className="divide-y divide-line">
              {c.priorities.map((p) => (
                <li key={p.key} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                  <ColorBadge color={p.color} label={p.label} />
                  <code className="text-[11px] text-fg-3">{p.key}</code>
                  <span className="ml-auto flex items-center gap-2"><Switch label={`${p.label} ativa`} checked={p.active} onCheckedChange={(v) => void run(put(`/admin/ticket-priorities/${p.key}`, { label: p.label, rank: p.rank, color: p.color, active: v }))} /> Ativa</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Status" description="As chaves são fixas (regras de negócio); nomes e cores são editáveis." />
            <ul className="divide-y divide-line">
              {c.statuses.map((s) => <StatusRow key={s.key} s={s} onSave={(label, color) => void run(put(`/admin/ticket-statuses/${s.key}`, { label, color, sortOrder: s.sortOrder }))} />)}
            </ul>
          </Card>
        </div>
      )}

      {tab === 'fluxo' && (
        <Card>
          <CardHeader title="Transições permitidas" description="S = solicitante, A = atendimento. Marque “motivo” para exigir justificativa. Nenhum usuário altera livremente qualquer status." />
          <div className="scrollbar-thin overflow-x-auto p-4">
            <table className="text-[12px]">
              <thead>
                <tr><th className="p-2 text-left text-fg-3">De \ Para</th>{TICKET_STATUS_KEYS.map((t) => <th key={t} className="p-2 text-fg-3">{c.statuses.find((s) => s.key === t)?.label}</th>)}</tr>
              </thead>
              <tbody>
                {TICKET_STATUS_KEYS.map((f) => (
                  <tr key={f} className="border-t border-line">
                    <th className="p-2 text-left font-medium">{c.statuses.find((s) => s.key === f)?.label}</th>
                    {TICKET_STATUS_KEYS.map((t) => (
                      <td key={t} className="p-2 text-center">
                        {f === t ? <span className="text-fg-3">—</span> : (
                          <div className="flex flex-col items-center gap-0.5">
                            {(['requester', 'handler'] as const).map((a) => {
                              const tr = has(f, t, a);
                              return (
                                <label key={a} className="flex items-center gap-1 whitespace-nowrap">
                                  <input type="checkbox" className="accent-[var(--brand)]" checked={!!tr} aria-label={`${f} para ${t} por ${a}`} onChange={(e) => void run(e.target.checked ? post('/admin/ticket-transitions', { fromStatus: f, toStatus: t, actor: a, requiresReason: false }) : api('/admin/ticket-transitions', { method: 'DELETE', body: { fromStatus: f, toStatus: t, actor: a } }))} />
                                  {a === 'requester' ? 'S' : 'A'}
                                  {tr && <button className={tr.requiresReason ? 'font-semibold text-warning' : 'text-fg-3'} title="Exigir motivo" onClick={() => void run(post('/admin/ticket-transitions', { ...tr, requiresReason: !tr.requiresReason }))}>{tr.requiresReason ? 'motivo' : '·'}</button>}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'sla' && cal && (
        <div className="space-y-6">
          {c.slaPolicies.filter((p) => p.active).length === 0 && <Notice tone="warning" title="SLA não configurado">Sem políticas ativas, os chamados exibem “SLA não configurado” e nenhum indicador de prazo é calculado.</Notice>}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title={`Calendário: ${cal.name}`} description={`Fuso horário ${cal.timezone}. Prazos contam somente horas úteis.`} />
              <CalendarEditor cal={cal} onSave={(wh) => void run(put(`/admin/business-calendars/${cal.id}`, { name: cal.name, timezone: cal.timezone, workingHours: wh }))} />
              <div className="border-t border-line p-5">
                <p className="mb-2 text-[13px] font-semibold">Feriados</p>
                <ul className="mb-3 space-y-1 text-[13px]">
                  {c.holidays.filter((h) => h.calendarId === cal.id).map((h) => (
                    <li key={h.id} className="flex items-center gap-2">{formatDate(`${h.date}T12:00:00`)} — {h.name}<Button size="icon" variant="ghost" aria-label={`Remover ${h.name}`} className="ml-auto" onClick={() => void run(api(`/admin/business-holidays/${h.id}`, { method: 'DELETE' }))}><Trash2 className="size-4" /></Button></li>
                  ))}
                </ul>
                <div className="flex gap-2"><Input type="date" aria-label="Data" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} className="w-40" /><Input aria-label="Nome do feriado" placeholder="Nome" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} /><Button disabled={!holiday.date || holiday.name.length < 2} onClick={() => void run(post(`/admin/business-calendars/${cal.id}/holidays`, holiday)).then(() => setHoliday({ date: '', name: '' }))}>Adicionar</Button></div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Políticas de SLA" actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setSla({ name: '', priorityKey: c.priorities[1]?.key, categoryId: null, calendarId: cal.id, firstResponseMinutes: 240, resolutionMinutes: 1440, active: true })}>Nova política</Button>} />
              <ul className="divide-y divide-line">
                {c.slaPolicies.length === 0 && <li className="px-5 py-4 text-[13px] text-fg-3">Nenhuma política.</li>}
                {c.slaPolicies.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[13px]">
                    <span className="font-medium">{p.name}</span>
                    <Badge>{c.priorities.find((x) => x.key === p.priorityKey)?.label}</Badge>
                    <span className="text-fg-3">{p.categoryId ? c.categories.find((x) => x.id === p.categoryId)?.name : 'todas as categorias'} · 1ª resposta {p.firstResponseMinutes} min · solução {p.resolutionMinutes} min úteis</span>
                    {!p.active && <Badge tone="danger">Inativa</Badge>}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSla(p)}>Editar</Button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {cat && (
        <Dialog open onOpenChange={(v) => !v && setCat(null)} title={cat.id ? 'Editar categoria' : 'Nova categoria'} footer={<><Button onClick={() => setCat(null)}>Cancelar</Button><Button variant="primary" disabled={(cat.name ?? '').trim().length < 2} onClick={() => { const body = { name: cat.name, description: cat.description || null, serviceDepartmentId: cat.serviceDepartmentId || null, defaultConfidential: !!cat.defaultConfidential, active: cat.active ?? true, sortOrder: cat.sortOrder ?? 100 }; void run(cat.id ? put(`/admin/ticket-categories/${cat.id}`, body) : post('/admin/ticket-categories', body)).then(() => setCat(null)); }}>Salvar</Button></>}>
          <div className="space-y-4">
            <Field label="Nome" required>{(id) => <Input id={id} value={cat.name ?? ''} onChange={(e) => setCat({ ...cat, name: e.target.value })} />}</Field>
            <Field label="Descrição">{(id) => <Input id={id} value={cat.description ?? ''} onChange={(e) => setCat({ ...cat, description: e.target.value })} />}</Field>
            <Field label="Encaminhar sempre para a central">{(id) => <Select id={id} value={cat.serviceDepartmentId ?? ''} onChange={(e) => setCat({ ...cat, serviceDepartmentId: e.target.value || null })}><option value="">Não — o solicitante escolhe o destino</option>{desks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
            <label className="flex items-center gap-2 text-[13px]"><Switch label="Confidencial por padrão" checked={!!cat.defaultConfidential} onCheckedChange={(v) => setCat({ ...cat, defaultConfidential: v })} /> Confidencial por padrão</label>
            <label className="flex items-center gap-2 text-[13px]"><Switch label="Ativa" checked={cat.active ?? true} onCheckedChange={(v) => setCat({ ...cat, active: v })} /> Ativa</label>
          </div>
        </Dialog>
      )}
      {sla && (
        <Dialog open onOpenChange={(v) => !v && setSla(null)} title={sla.id ? 'Editar política de SLA' : 'Nova política de SLA'} footer={<><Button onClick={() => setSla(null)}>Cancelar</Button><Button variant="primary" disabled={(sla.name ?? '').trim().length < 2} onClick={() => { const body = { name: sla.name, priorityKey: sla.priorityKey, categoryId: sla.categoryId || null, calendarId: sla.calendarId, firstResponseMinutes: Number(sla.firstResponseMinutes), resolutionMinutes: Number(sla.resolutionMinutes), active: sla.active ?? true }; void run(sla.id ? put(`/admin/sla-policies/${sla.id}`, body) : post('/admin/sla-policies', body)).then(() => setSla(null)); }}>Salvar</Button></>}>
          <div className="space-y-4">
            <Field label="Nome" required>{(id) => <Input id={id} value={sla.name ?? ''} onChange={(e) => setSla({ ...sla, name: e.target.value })} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prioridade">{(id) => <Select id={id} value={sla.priorityKey} onChange={(e) => setSla({ ...sla, priorityKey: e.target.value })}>{c.priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select>}</Field>
              <Field label="Categoria">{(id) => <Select id={id} value={sla.categoryId ?? ''} onChange={(e) => setSla({ ...sla, categoryId: e.target.value || null })}><option value="">Todas</option>{c.categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
              <Field label="1ª resposta (min úteis)">{(id) => <Input id={id} type="number" min={1} value={sla.firstResponseMinutes} onChange={(e) => setSla({ ...sla, firstResponseMinutes: Number(e.target.value) })} />}</Field>
              <Field label="Solução (min úteis)">{(id) => <Input id={id} type="number" min={1} value={sla.resolutionMinutes} onChange={(e) => setSla({ ...sla, resolutionMinutes: Number(e.target.value) })} />}</Field>
            </div>
            <label className="flex items-center gap-2 text-[13px]"><Switch label="Ativa" checked={sla.active ?? true} onCheckedChange={(v) => setSla({ ...sla, active: v })} /> Ativa</label>
          </div>
        </Dialog>
      )}
    </AdminPage>
  );
}

function StatusRow({ s, onSave }: { s: Config['statuses'][number]; onSave: (label: string, color: string) => void }) {
  const [label, setLabel] = useState(s.label);
  const [color, setColor] = useState(s.color);
  return (
    <li className="flex items-center gap-2 px-5 py-2">
      <input type="color" aria-label={`Cor de ${s.label}`} value={color} onChange={(e) => setColor(e.target.value)} className="size-7 rounded border border-line bg-transparent" />
      <Input aria-label={`Nome do status ${s.key}`} value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" />
      <code className="text-[11px] text-fg-3">{s.key}</code>
      <Button size="sm" disabled={label === s.label && color === s.color} onClick={() => onSave(label, color)}>Salvar</Button>
    </li>
  );
}

function CalendarEditor({ cal, onSave }: { cal: Config['calendars'][number]; onSave: (wh: Record<string, [string, string][]>) => void }) {
  const [wh, setWh] = useState(cal.workingHours);
  return (
    <div className="space-y-2 p-5">
      {DAYS.map((d, i) => {
        const intervals = wh[String(i)] ?? [];
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="w-10 font-medium">{d}</span>
            {intervals.length === 0 && <span className="text-fg-3">Sem expediente</span>}
            {intervals.map(([a, b], j) => (
              <span key={j} className="flex items-center gap-1">
                <Input type="time" aria-label={`${d} início ${j + 1}`} value={a} className="h-8 w-28" onChange={(e) => setWh({ ...wh, [i]: intervals.map((x, k) => (k === j ? [e.target.value, x[1]] : x)) as [string, string][] })} />–
                <Input type="time" aria-label={`${d} fim ${j + 1}`} value={b} className="h-8 w-28" onChange={(e) => setWh({ ...wh, [i]: intervals.map((x, k) => (k === j ? [x[0], e.target.value] : x)) as [string, string][] })} />
                <Button size="icon" variant="ghost" aria-label="Remover intervalo" onClick={() => setWh({ ...wh, [i]: intervals.filter((_, k) => k !== j) })}><Trash2 className="size-3.5" /></Button>
              </span>
            ))}
            {intervals.length < 4 && <Button size="sm" variant="ghost" onClick={() => setWh({ ...wh, [i]: [...intervals, ['09:00', '18:00']] })}>+ intervalo</Button>}
          </div>
        );
      })}
      <Button className="mt-2" variant="primary" onClick={() => onSave(wh)}>Salvar calendário</Button>
    </div>
  );
}
