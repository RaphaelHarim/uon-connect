import { API_PREFIX, TICKET_STATUS_KEYS, DEFAULT_TICKET_STATUS_LABELS } from '@uon/shared/browser';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Lock, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Badge, Button, Card, ColorBadge, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Skeleton, Tabs } from '@/components/ui';
import { get } from '@/lib/api';
import { formatRelative } from '@/lib/format';

export interface TicketListItem {
  id: string;
  protocol: string;
  title: string;
  status: { key: string; label: string; color: string };
  priority: { key: string; label: string; color: string };
  category: string;
  handlingDepartment: string;
  handlingTeam: string | null;
  client: string | null;
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  confidential: boolean;
  sla: string;
  createdAt: string;
  updatedAt: string;
}

export const SLA_BADGE: Record<string, { tone: 'neutral' | 'success' | 'warning' | 'danger'; label: string }> = {
  not_configured: { tone: 'neutral', label: 'SLA não configurado' },
  on_track: { tone: 'success', label: 'No prazo' },
  at_risk: { tone: 'warning', label: 'Prazo próximo' },
  breached: { tone: 'danger', label: 'Prazo vencido' },
  met: { tone: 'success', label: 'Cumprido' },
  missed: { tone: 'danger', label: 'Fora do prazo' },
};

const STORAGE_KEY = 'uon-ticket-filters';

export default function TicketsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const options = useQuery({ queryKey: ['tickets', 'form-options'], queryFn: () => get<{ categories: { id: string; name: string }[]; priorities: { key: string; label: string }[]; clients: { id: string; name: string }[] }>('/tickets/form-options'), staleTime: 300_000 });

  // Filters live in the URL (shareable, back-button friendly); the last set is remembered per browser.
  useEffect(() => {
    if ([...params.keys()].length === 0) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) setParams(new URLSearchParams(saved), { replace: true });
      } catch {
        /* storage unavailable */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      const p = new URLSearchParams(params);
      p.delete('page');
      localStorage.setItem(STORAGE_KEY, p.toString());
    } catch {
      /* ignore */
    }
  }, [params]);

  const view = params.get('view') ?? 'all';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    setParams(p, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== (params.get('q') ?? '') && set('q', q || null), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const qs = new URLSearchParams(params);
  qs.set('pageSize', '25');
  const list = useQuery({
    queryKey: ['tickets', qs.toString()],
    queryFn: ({ signal }) => get<{ items: TicketListItem[]; total: number; page: number; pageSize: number }>(`/tickets?${qs}`, signal),
    placeholderData: keepPreviousData,
  });
  const exportQs = new URLSearchParams(params);
  exportQs.delete('page');

  return (
    <PageContainer wide>
      <PageHeader
        title="Chamados"
        description="Solicitações internas com protocolo, responsável, prazos e histórico."
        actions={
          <>
            <a href={`${API_PREFIX}/tickets/export?${exportQs}`}>
              <Button icon={<Download className="size-4" />}>Exportar CSV</Button>
            </a>
            <Link to="/chamados/novo">
              <Button variant="primary" icon={<Plus className="size-4" />}>
                Abrir chamado
              </Button>
            </Link>
          </>
        }
      />
      <Tabs
        value={view}
        onValueChange={(v) => set('view', v === 'all' ? null : v)}
        items={[
          { value: 'all', label: 'Todos que posso ver' },
          { value: 'requested', label: 'Abertos por mim' },
          { value: 'assigned', label: 'Atribuídos a mim' },
          { value: 'queue', label: 'Filas que atendo' },
          { value: 'watching', label: 'Compartilhados comigo' },
        ]}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Protocolo ou título" aria-label="Pesquisar chamados" className="pl-9" />
          </div>
          <Select aria-label="Status" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value || null)} className="w-auto">
            <option value="">Todos os status</option>
            <option value="open,triage,in_progress,waiting_requester,waiting_third_party">Em aberto (todos)</option>
            {TICKET_STATUS_KEYS.map((s) => (
              <option key={s} value={s}>
                {DEFAULT_TICKET_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select aria-label="Prioridade" value={params.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value || null)} className="w-auto">
            <option value="">Todas as prioridades</option>
            {options.data?.priorities.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Categoria" value={params.get('categoryId') ?? ''} onChange={(e) => set('categoryId', e.target.value || null)} className="w-auto">
            <option value="">Todas as categorias</option>
            {options.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Carteira" value={params.get('clientId') ?? ''} onChange={(e) => set('clientId', e.target.value || null)} className="w-auto">
            <option value="">Todas as carteiras</option>
            {options.data?.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Responsável" value={params.get('assigneeId') ?? ''} onChange={(e) => set('assigneeId', e.target.value || null)} className="w-auto">
            <option value="">Qualquer responsável</option>
            <option value="me">Atribuídos a mim</option>
            <option value="none">Sem responsável</option>
          </Select>
          <Input type="date" aria-label="Aberto a partir de" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value || null)} className="w-40" />
          <Input type="date" aria-label="Aberto até" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value || null)} className="w-40" />
          <Select aria-label="Ordenação" value={params.get('sort') ?? 'updated_desc'} onChange={(e) => set('sort', e.target.value)} className="w-auto">
            <option value="updated_desc">Atualizados recentemente</option>
            <option value="created_desc">Mais novos</option>
            <option value="created_asc">Mais antigos</option>
            <option value="priority_desc">Maior prioridade</option>
          </Select>
          {[...params.keys()].some((k) => !['view', 'page'].includes(k)) && (
            <Button variant="ghost" size="sm" onClick={() => setParams(view === 'all' ? {} : { view }, { replace: true })}>
              Limpar filtros
            </Button>
          )}
        </div>

        {list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : list.data!.items.length === 0 ? (
          <EmptyState
            title="Nenhum chamado encontrado"
            description={view === 'queue' ? 'Você não atende nenhuma fila ou ela está vazia.' : 'Ajuste os filtros ou abra um novo chamado.'}
            action={<Link to="/chamados/novo"><Button variant="primary">Abrir chamado</Button></Link>}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2/60 text-left text-xs text-fg-3">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Chamado</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Prioridade</th>
                    <th className="px-3 py-2.5 font-medium">Fila</th>
                    <th className="px-3 py-2.5 font-medium">Solicitante</th>
                    <th className="px-3 py-2.5 font-medium">Responsável</th>
                    <th className="px-3 py-2.5 font-medium">Prazo</th>
                    <th className="px-4 py-2.5 text-right font-medium">Atualizado</th>
                  </tr>
                </thead>
                <tbody className={list.isPlaceholderData ? 'opacity-60' : undefined}>
                  {list.data!.items.map((t) => (
                    <tr key={t.id} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => navigate(`/chamados/${t.id}`)}>
                      <td className="max-w-[340px] px-4 py-2.5">
                        <Link to={`/chamados/${t.id}`} className="block" onClick={(e) => e.stopPropagation()}>
                          <span className="font-mono text-[11px] text-fg-3">{t.protocol}</span>
                          <span className="flex items-center gap-1.5 truncate font-medium text-fg">
                            {t.confidential && <Lock className="size-3.5 shrink-0 text-fg-3" aria-label="Confidencial" />}
                            <span className="truncate">{t.title}</span>
                          </span>
                          <span className="text-xs text-fg-3">{t.category}{t.client ? ` · ${t.client}` : ''}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5"><ColorBadge color={t.status.color} label={t.status.label} /></td>
                      <td className="px-3 py-2.5"><ColorBadge color={t.priority.color} label={t.priority.label} /></td>
                      <td className="px-3 py-2.5 text-fg-2">{t.handlingTeam ?? t.handlingDepartment}</td>
                      <td className="px-3 py-2.5 text-fg-2">{t.requester.name}</td>
                      <td className="px-3 py-2.5 text-fg-2">{t.assignee?.name ?? <span className="text-fg-3">—</span>}</td>
                      <td className="px-3 py-2.5"><Badge tone={SLA_BADGE[t.sla]?.tone}>{SLA_BADGE[t.sla]?.label}</Badge></td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap text-fg-3">{formatRelative(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {list.data!.items.map((t) => (
                <li key={t.id}>
                  <Link to={`/chamados/${t.id}`} className="block space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-fg-3">{t.protocol}</span>
                      <span className="text-xs text-fg-3">{formatRelative(t.updatedAt)}</span>
                    </div>
                    <p className="font-medium">{t.confidential && <Lock className="mr-1 inline size-3.5 text-fg-3" aria-label="Confidencial" />}{t.title}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <ColorBadge color={t.status.color} label={t.status.label} />
                      <ColorBadge color={t.priority.color} label={t.priority.label} />
                      <Badge tone={SLA_BADGE[t.sla]?.tone}>{SLA_BADGE[t.sla]?.label}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={25} total={list.data!.total} onPage={(p) => set('page', String(p))} />
          </>
        )}
      </Card>
    </PageContainer>
  );
}
