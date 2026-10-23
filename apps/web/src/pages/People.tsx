import { type PresenceView, PRESENCE_LABELS, type UserSummary } from '@uon/shared/browser';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar, Badge, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner } from '@/components/ui';
import { get } from '@/lib/api';
import { usePresence } from '@/lib/realtime';

export interface DirectoryPerson extends UserSummary {
  org: { departmentId: string; departmentName: string; teamId: string | null; teamName: string | null; role: string }[];
  presence: PresenceView | null;
}

export default function PeoplePage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const page = Number(params.get('page') ?? 1);
  const departmentId = params.get('dep') ?? '';
  const structure = useQuery({ queryKey: ['org'], queryFn: () => get<{ departments: { id: string; name: string }[] }>('/org/structure') });
  const list = useQuery({
    queryKey: ['directory', q, page, departmentId],
    queryFn: () => get<{ items: DirectoryPerson[]; total: number }>(`/directory?pageSize=24&page=${page}&q=${encodeURIComponent(q)}${departmentId ? `&departmentId=${departmentId}` : ''}`),
    placeholderData: keepPreviousData,
  });
  return (
    <PageContainer wide>
      <PageHeader title="Pessoas" description="Diretório de colaboradores ativos. Telefones aparecem apenas para colegas do mesmo departamento." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setParams((p) => { p.delete('page'); return p; }, { replace: true }); }} placeholder="Nome, e-mail ou cargo" aria-label="Pesquisar pessoas" className="pl-9" />
        </div>
        <Select aria-label="Departamento" value={departmentId} onChange={(e) => setParams((p) => { if (e.target.value) p.set('dep', e.target.value); else p.delete('dep'); p.delete('page'); return p; }, { replace: true })} className="w-auto">
          <option value="">Todos os departamentos</option>
          {structure.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorState error={list.error} /> : list.data!.items.length === 0 ? <EmptyState title="Ninguém encontrado" /> : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.data!.items.map((p) => <PersonCard key={p.id} p={p} />)}
          </ul>
          <Card className="mt-4"><Pagination page={page} pageSize={24} total={list.data!.total} onPage={(n) => setParams((p) => { p.set('page', String(n)); return p; })} /></Card>
        </>
      )}
    </PageContainer>
  );
}

function PersonCard({ p }: { p: DirectoryPerson }) {
  const presence = usePresence(p.id, p.presence);
  const orgText = [...new Set(p.org.map((o) => o.teamName ?? o.departmentName))].join(' · ');
  return (
    <li>
      <Link to={`/pessoas/${p.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-card hover:border-line-strong">
        <Avatar name={p.displayName} src={p.avatarUrl} size={44} presence={presence?.status ?? null} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{p.displayName}</span>
          <span className="block truncate text-xs text-fg-2">{p.jobTitle ?? '—'}</span>
          <span className="block truncate text-xs text-fg-3">{orgText || 'Sem vínculo organizacional'}</span>
          {presence && <span className="text-[11px] text-fg-3">{PRESENCE_LABELS[presence.status]}</span>}
          {p.isDemo && <Badge className="mt-1" tone="info">Demonstração</Badge>}
        </span>
      </Link>
    </li>
  );
}
