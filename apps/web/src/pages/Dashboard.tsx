import { API_PREFIX } from '@uon/shared/browser';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, CheckCircle2, Clock3, Download, Hourglass, Inbox, MessageSquarePlus, Plus, Ticket, UserCheck, Users } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BarList, ChartFrame, ColumnChart, LineChart } from '@/components/charts';
import { PageContainer } from '@/components/layout/AppShell';
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, Notice, PageHeader, Select, Skeleton, Stat, Tabs } from '@/components/ui';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { daysAgo, formatDateTime, formatHours, formatNumber, formatRelative, isoDay } from '@/lib/format';

interface Scopes {
  teams: { id: string; name: string; clientId: string | null }[];
  departments: { id: string; name: string }[];
  admin: boolean;
}

interface Metrics {
  range: { from: string; to: string };
  summary: {
    created: number;
    backlog: number;
    resolved: number;
    unassigned: number;
    sla: { overdue: number; withoutSla: number; resolvedWithSla: number; resolvedWithinSla: number; complianceRate: number | null };
    resolutionHours: { average: number | null; median: number | null; sample: number };
  };
  byStatus: { key: string; label: string; n: number }[];
  weekly: { week: string; n: number }[];
  workload: { user_id: string | null; name: string; open: number; resolved: number }[];
  byClient: { id: string | null; name: string; created: number; resolved: number; backlog: number; avg_resolution_hours: number | null }[];
  byTeam: { id: string | null; name: string; created: number; backlog: number; resolved: number }[];
  definitions: Record<string, string>;
  monthlyByClient?: { month: string; client: string; n: number }[];
  department?: { id: string; name: string };
  activeMembers?: number;
}

export default function DashboardPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const scopes = useQuery({ queryKey: ['dashboards', 'scopes'], queryFn: () => get<Scopes>('/dashboards/scopes') });
  const tabs = [
    { value: 'pessoal', label: 'Meu painel' },
    ...(scopes.data?.teams.length ? [{ value: 'equipe', label: 'Minhas equipes' }] : []),
    ...(scopes.data?.departments.length ? [{ value: 'departamento', label: 'Departamento' }] : []),
    ...(scopes.data?.admin ? [{ value: 'admin', label: 'Plataforma' }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('visao')) ? params.get('visao')! : 'pessoal';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <PageContainer wide>
      <PageHeader
        title={`${greeting}, ${me.user.displayName.split(' ')[0]}`}
        description="Indicadores calculados a partir dos registros do sistema, conforme o que você tem permissão para ver."
        actions={
          <>
            <Link to="/conversas">
              <Button icon={<MessageSquarePlus className="size-4" />}>Nova conversa</Button>
            </Link>
            <Link to="/chamados/novo">
              <Button variant="primary" icon={<Plus className="size-4" />}>
                Abrir chamado
              </Button>
            </Link>
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const p = new URLSearchParams(params);
          p.set('visao', v);
          setParams(p, { replace: true });
        }}
        items={tabs}
      />
      {tab === 'pessoal' && <PersonalDashboard />}
      {tab === 'equipe' && scopes.data && <ScopedDashboard kind="team" scopes={scopes.data} />}
      {tab === 'departamento' && scopes.data && <ScopedDashboard kind="department" scopes={scopes.data} />}
      {tab === 'admin' && <AdminDashboard />}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ personal */

interface Personal {
  counts: Record<string, number>;
  unassignedInMyQueues: number;
  unreadNotifications: number;
  recentActivity: { id: number; type: string; to: string | null; createdAt: string; ticketId: string; protocol: string; title: string; actorName: string | null }[];
  upcomingMeetings: { id: string; title: string; start: string; status: string }[];
  definitions: Record<string, string>;
}

const EVENT_LABELS: Record<string, string> = {
  created: 'abriu',
  assigned: 'atribuiu',
  status_changed: 'alterou o status de',
  reopened: 'reabriu',
  comment: 'comentou em',
  priority_changed: 'alterou a prioridade de',
  watcher_added: 'compartilhou',
  watcher_removed: 'removeu um acompanhante de',
  sla_warning: 'alerta de prazo em',
};

function PersonalDashboard() {
  const q = useQuery({ queryKey: ['dashboards', 'personal'], queryFn: () => get<Personal>('/dashboards/personal') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data?.counts;
  const d = q.data?.definitions ?? {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!c ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px]" />)
        ) : (
          <>
            <Link to="/chamados?view=requested&status=open,triage,in_progress,waiting_requester,waiting_third_party">
              <Stat label="Meus chamados em aberto" value={formatNumber(c.requested_open)} hint={d.requested_open} icon={<Ticket className="size-4" />} />
            </Link>
            <Link to="/chamados?view=requested&status=waiting_requester">
              <Stat label="Aguardando minha resposta" value={formatNumber(c.waiting_me)} hint={d.waiting_me} tone={c.waiting_me ? 'warning' : undefined} icon={<Hourglass className="size-4" />} />
            </Link>
            <Link to="/chamados?view=assigned&status=open,triage,in_progress,waiting_requester,waiting_third_party">
              <Stat label="Atribuídos a mim" value={formatNumber(c.assigned_open)} hint={d.assigned_open} icon={<UserCheck className="size-4" />} />
            </Link>
            <Link to="/chamados?view=queue&assigneeId=none">
              <Stat label="Sem responsável nas minhas filas" value={formatNumber(q.data!.unassignedInMyQueues)} hint={d.unassignedInMyQueues} icon={<Inbox className="size-4" />} />
            </Link>
          </>
        )}
      </div>
      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MiniStat label="Em andamento (meus)" value={c.requested_in_progress} />
          <MiniStat label="Resolvidos, aguardando confirmação" value={c.requested_resolved_pending_close} />
          <MiniStat label="Resolvidos por mim (30 dias)" value={c.assigned_resolved_30d} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Atividade recente" description="Movimentações nos chamados que você pode ver." />
          {q.isLoading ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : q.data!.recentActivity.length === 0 ? (
            <EmptyState title="Nenhuma atividade ainda" description="Quando você abrir ou acompanhar chamados, as movimentações aparecerão aqui." />
          ) : (
            <ul className="divide-y divide-line">
              {q.data!.recentActivity.map((a) => (
                <li key={a.id}>
                  <Link to={`/chamados/${a.ticketId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <Clock3 className="size-4 shrink-0 text-fg-3" aria-hidden />
                    <p className="min-w-0 flex-1 truncate text-[13px]">
                      <span className="font-medium">{a.actorName ?? 'Sistema'}</span> {EVENT_LABELS[a.type] ?? 'atualizou'} <span className="font-mono text-xs text-fg-2">{a.protocol}</span>{' '}
                      <span className="text-fg-3">· {a.title}</span>
                    </p>
                    <span className="shrink-0 text-xs text-fg-3">{formatRelative(a.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Próximas reuniões" actions={<Link to="/reunioes" className="text-[13px] font-medium text-brand-text hover:underline">Ver todas</Link>} />
          {q.data && q.data.upcomingMeetings.length === 0 ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title="Sem reuniões agendadas" description="Chamadas e reuniões criadas na plataforma aparecem aqui." />
          ) : (
            <ul className="divide-y divide-line">
              {q.data?.upcomingMeetings.map((m) => (
                <li key={m.id}>
                  <Link to={`/reunioes/${m.id}`} className="block px-5 py-3 hover:bg-surface-2">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-fg-3">{m.status === 'live' ? 'Em andamento agora' : formatDateTime(m.start)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs text-fg-3">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{formatNumber(value ?? 0)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ team / department */

function ScopedDashboard({ kind, scopes }: { kind: 'team' | 'department'; scopes: Scopes }) {
  const [params, setParams] = useSearchParams();
  const from = params.get('de') ?? daysAgo(30);
  const to = params.get('ate') ?? isoDay(new Date());
  const teamId = params.get('equipe') ?? '';
  const departmentId = params.get('dep') ?? scopes.departments[0]?.id ?? '';
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const qs = new URLSearchParams({ from, to, ...(kind === 'team' && teamId ? { teamId } : {}), ...(kind === 'department' && departmentId ? { departmentId } : {}), ...(kind === 'department' && teamId ? { teamId } : {}) });
  const q = useQuery({ queryKey: ['dashboards', kind, qs.toString()], queryFn: () => get<Metrics>(`/dashboards/${kind}?${qs}`) });
  const m = q.data;

  const monthly = useMemo(() => {
    if (!m?.monthlyByClient?.length) return null;
    const months = [...new Set(m.monthlyByClient.map((r) => r.month))].sort();
    const clients = [...new Set(m.monthlyByClient.map((r) => r.client))].sort((a, b) => (a === 'Sem carteira' ? 1 : b === 'Sem carteira' ? -1 : a.localeCompare(b)));
    const series = clients.map((c) => ({ name: c, values: months.map((mo) => m.monthlyByClient!.find((r) => r.month === mo && r.client === c)?.n ?? 0) }));
    return { months, series, label: months.map((mo) => new Date(`${mo}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' })) };
  }, [m]);

  const presets = [
    ['7 dias', 7],
    ['30 dias', 30],
    ['90 dias', 90],
    ['12 meses', 365],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3 shadow-card">
        {kind === 'department' && scopes.departments.length > 1 && (
          <label className="text-[13px]">
            <span className="mb-1 block font-medium">Departamento</span>
            <Select value={departmentId} onChange={(e) => set('dep', e.target.value)} className="w-48">
              {scopes.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {kind === 'team' && (
          <label className="text-[13px]">
            <span className="mb-1 block font-medium">Equipe</span>
            <Select value={teamId} onChange={(e) => set("equipe", e.target.value)} className="w-64">
              <option value="">Todas as minhas equipes</option>
              {scopes.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">De</span>
          <Input type="date" value={from} max={to} onChange={(e) => set('de', e.target.value)} className="w-40" />
        </label>
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">Até</span>
          <Input type="date" value={to} min={from} onChange={(e) => set('ate', e.target.value)} className="w-40" />
        </label>
        <div className="flex gap-1" role="group" aria-label="Períodos rápidos">
          {presets.map(([label, n]) => (
            <Button key={n} size="sm" variant={from === daysAgo(n) ? 'subtle' : 'ghost'} onClick={() => {
              const p = new URLSearchParams(params);
              p.set('de', daysAgo(n));
              p.set('ate', isoDay(new Date()));
              setParams(p, { replace: true });
            }}>
              {label}
            </Button>
          ))}
        </div>
        {kind === 'department' && (
          <a className="ml-auto" href={`${API_PREFIX}/dashboards/department/export?${qs}`}>
            <Button size="sm" icon={<Download className="size-4" />}>Exportar CSV</Button>
          </a>
        )}
      </div>

      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!m && !q.error && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[108px]" />)}</div>}

      {m && (
        <>
          {kind === 'department' && m.department && <h2 className="text-base font-semibold">{m.department.name}</h2>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Abertos no período" value={formatNumber(m.summary.created)} hint={m.definitions.created} icon={<Ticket className="size-4" />} />
            <Stat label="Pendentes agora" value={formatNumber(m.summary.backlog)} hint={`${formatNumber(m.summary.unassigned)} sem responsável`} icon={<Inbox className="size-4" />} />
            <Stat label="Resolvidos no período" value={formatNumber(m.summary.resolved)} icon={<CheckCircle2 className="size-4" />} tone="success" />
            <Stat
              label="Tempo de resolução (mediana)"
              value={formatHours(m.summary.resolutionHours.median)}
              hint={`Média ${formatHours(m.summary.resolutionHours.average)} · ${m.summary.resolutionHours.sample} chamados · horas corridas`}
              icon={<Clock3 className="size-4" />}
            />
          </div>

          <SlaCard sla={m.summary.sla} definition={m.definitions.sla!} />

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartFrame
              title="Volume por semana"
              description="Chamados abertos em cada semana do período"
              definition={m.definitions.weekly}
              table={{ columns: ['Semana (início)', 'Chamados'], rows: m.weekly.map((w) => [new Date(`${w.week}T12:00:00`).toLocaleDateString('pt-BR'), w.n]) }}
            >
              <ColumnChart data={m.weekly.map((w) => ({ label: new Date(`${w.week}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: w.n }))} />
            </ChartFrame>
            <ChartFrame title="Situação atual" description="Status dos chamados abertos no período" definition={m.definitions.byStatus} table={{ columns: ['Status', 'Chamados'], rows: m.byStatus.map((s) => [s.label, s.n]) }}>
              <BarList data={m.byStatus.map((s) => ({ label: s.label, value: s.n }))} />
            </ChartFrame>
          </div>

          {monthly && monthly.series.length > 0 && (
            <ChartFrame
              title="Evolução mensal por carteira"
              description="Chamados abertos por mês, últimos 12 meses"
              definition={m.definitions.monthly}
              table={{ columns: ['Mês', ...monthly.series.map((s) => s.name)], rows: monthly.months.map((mo, i) => [mo, ...monthly.series.map((s) => s.values[i]!)]) }}
            >
              <LineChart labels={monthly.label} series={monthly.series.filter((s) => s.name !== 'Sem carteira').length ? monthly.series.filter((s) => s.name !== 'Sem carteira') : monthly.series} />
            </ChartFrame>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Comparação entre carteiras" description="Cada chamado é contado uma vez, na carteira do solicitante." />
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-fg-3">
                      <th className="px-5 py-2 font-medium">Carteira</th>
                      <th className="px-3 py-2 text-right font-medium">Abertos</th>
                      <th className="px-3 py-2 text-right font-medium">Resolvidos</th>
                      <th className="px-3 py-2 text-right font-medium">Pendentes</th>
                      <th className="px-5 py-2 text-right font-medium">Tempo médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.byClient.map((c) => (
                      <tr key={c.name} className="border-t border-line">
                        <td className="px-5 py-2 font-medium">{c.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.created)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.resolved)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.backlog)}</td>
                        <td className="px-5 py-2 text-right tabular-nums">{formatHours(c.avg_resolution_hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <ChartFrame
              title="Distribuição de carga"
              description="Chamados pendentes por responsável (e resolvidos no período)"
              definition={m.definitions.workload}
              table={{ columns: ['Responsável', 'Pendentes', 'Resolvidos no período'], rows: m.workload.map((w) => [w.name, w.open, w.resolved]) }}
            >
              <BarList data={m.workload.map((w) => ({ label: w.name, value: w.open, hint: `· ${w.resolved} resolvidos` }))} emptyText="Nenhum chamado pendente." />
            </ChartFrame>
          </div>

          {m.byTeam.length > 1 && (
            <ChartFrame title="Por equipe" description="Chamados abertos no período, por equipe atendente ou solicitante" table={{ columns: ['Equipe', 'Abertos', 'Pendentes', 'Resolvidos'], rows: m.byTeam.map((t) => [t.name, t.created, t.backlog, t.resolved]) }}>
              <BarList data={m.byTeam.map((t) => ({ label: t.name, value: t.created }))} />
            </ChartFrame>
          )}
          <Notice tone="neutral" icon={<Users className="size-4" />}>
            Os indicadores mostram volume e tempo, não produtividade. Considere complexidade, contexto e período antes de comparar pessoas ou equipes.
          </Notice>
        </>
      )}
    </div>
  );
}

function SlaCard({ sla, definition }: { sla: Metrics['summary']['sla']; definition: string }) {
  const configured = sla.resolvedWithSla > 0 || sla.overdue > 0;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2">
          <AlarmClock className="size-4 text-fg-3" aria-hidden />
          <p className="text-sm font-semibold">SLA de resolução</p>
        </div>
        {!configured && sla.withoutSla > 0 ? (
          <p className="text-[13px] text-fg-2">SLA não configurado para os chamados deste escopo — não há prazo a cumprir ou medir.</p>
        ) : (
          <>
            <p className="text-[13px]">
              <span className="font-semibold tabular-nums">{sla.complianceRate === null ? '—' : `${sla.complianceRate.toLocaleString('pt-BR')}%`}</span> <span className="text-fg-3">resolvidos dentro do prazo ({sla.resolvedWithinSla}/{sla.resolvedWithSla})</span>
            </p>
            <p className="text-[13px]">
              <span className={sla.overdue ? 'font-semibold text-danger tabular-nums' : 'font-semibold tabular-nums'}>{sla.overdue}</span> <span className="text-fg-3">pendentes com prazo vencido</span>
            </p>
            {sla.withoutSla > 0 && <p className="text-[13px] text-fg-3">{sla.withoutSla} pendentes sem SLA configurado</p>}
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-fg-3">{definition}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ admin */

interface AdminData {
  totals: Record<string, number | boolean>;
  ticketsByStatus: { label: string; n: number }[];
  securityEvents: { action: string; outcome: string; n: number }[] | null;
  failedJobs: { id: number; type: string; last_error: string }[];
  integrationErrors: { integration_key: string; message: string; occurred_at: string }[];
  definitions: Record<string, string>;
}

function AdminDashboard() {
  const q = useQuery({ queryKey: ['dashboards', 'admin'], queryFn: () => get<AdminData>('/dashboards/admin') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const t = q.data.totals;
  return (
    <div className="space-y-6">
      <Notice tone="neutral">{q.data.definitions.admin}</Notice>
      {!t.founder_configured && <Notice tone="warning" title="Conta fundadora não configurada">Execute o procedimento de bootstrap descrito em docs/RECOVERY.md.</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Usuários ativos" value={formatNumber(t.users_active as number)} hint={`${t.users_inactive} inativos · ${t.users_demo} de demonstração`} />
        <Stat label="Departamentos / equipes" value={`${t.departments} / ${t.teams}`} hint={`${t.clients} carteiras de clientes`} />
        <Stat label="Chamados (30 dias)" value={formatNumber(t.tickets_30d as number)} hint={`${t.tickets_backlog} pendentes · ${t.tickets_total} no total`} />
        <Stat label="Sessões ativas" value={formatNumber(t.active_sessions as number)} hint={`${t.supreme_admins} Supreme Admin(s) · ${t.sla_policies} políticas de SLA`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame title="Chamados por status" description="Todos os chamados (apenas contagem)" table={{ columns: ['Status', 'Chamados'], rows: q.data.ticketsByStatus.map((s) => [s.label, s.n]) }}>
          <BarList data={q.data.ticketsByStatus.map((s) => ({ label: s.label, value: s.n }))} />
        </ChartFrame>
        <Card>
          <CardHeader title="Eventos de segurança (7 dias)" description="Falhas, negações e ações sobre funções" />
          {q.data.securityEvents === null ? (
            <p className="px-5 py-6 text-[13px] text-fg-3">Visível apenas para Supreme Admin e Auditoria.</p>
          ) : q.data.securityEvents.length === 0 ? (
            <EmptyState title="Nenhum evento relevante" />
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {q.data.securityEvents.map((e) => (
                <li key={`${e.action}${e.outcome}`} className="flex justify-between px-5 py-2">
                  <span className="font-mono text-xs">{e.action}</span>
                  <span className={e.outcome === 'success' ? 'text-fg-2' : 'text-danger'}>
                    {e.outcome} · <b className="tabular-nums">{e.n}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Fila de tarefas" description={`${t.jobs_pending} pendentes · ${t.jobs_failed} com falha`} />
          {q.data.failedJobs.length === 0 ? <EmptyState title="Sem falhas na fila" /> : (
            <ul className="divide-y divide-line text-[13px]">
              {q.data.failedJobs.map((j) => <li key={j.id} className="px-5 py-2"><span className="font-mono text-xs">#{j.id} {j.type}</span><p className="truncate text-fg-3">{j.last_error}</p></li>)}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Erros de integração" actions={<Link className="text-[13px] font-medium text-brand-text hover:underline" to="/admin/integracoes">Integrações</Link>} />
          {q.data.integrationErrors.length === 0 ? <EmptyState title="Nenhum erro registrado" /> : (
            <ul className="divide-y divide-line text-[13px]">
              {q.data.integrationErrors.map((e, i) => <li key={i} className="px-5 py-2"><span className="font-medium">{e.integration_key}</span> <span className="text-fg-3">· {formatRelative(e.occurred_at)}</span><p className="truncate text-fg-3">{e.message}</p></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
