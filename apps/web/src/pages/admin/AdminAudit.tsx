import { API_PREFIX } from '@uon/shared/browser';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Notice, Pagination, Select, Spinner } from '@/components/ui';
import { get } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { AdminPage } from './common';

interface Event { id: number; occurredAt: string; actorLabel: string | null; action: string; resourceType: string | null; resourceId: string | null; outcome: string; correlationId: string | null; ip: string | null; metadata: Record<string, unknown> | null; hash: string }

export default function AdminAudit() {
  const [f, setF] = useState({ action: '', outcome: '', resourceType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: '50' }).filter(([, v]) => v));
  const q = useQuery({ queryKey: ['audit', qs.toString()], queryFn: () => get<{ items: Event[]; total: number }>(`/admin/audit?${qs}`), placeholderData: keepPreviousData });
  const verify = useMutation({ mutationFn: () => get<{ ok: boolean; total: number; broken: number; firstBrokenId: number | null }>('/admin/audit/verify') });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <AdminPage permission="audit.read" title="Auditoria" description="Registro somente de inclusão: nem administradores podem alterar ou apagar eventos. Cada evento é encadeado por hash SHA-256." actions={<><Button icon={<ShieldCheck className="size-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>Verificar integridade</Button><a href={`${API_PREFIX}/admin/audit/export?${qs}`}><Button icon={<Download className="size-4" />}>Exportar CSV</Button></a></>}>
      {verify.data && <div className="mb-4"><Notice tone={verify.data.ok ? 'success' : 'danger'} title={verify.data.ok ? 'Cadeia íntegra' : 'Inconsistência detectada'}>{verify.data.ok ? `${verify.data.total} eventos verificados, nenhuma alteração detectada.` : `${verify.data.broken} evento(s) inconsistentes; primeiro id ${verify.data.firstBrokenId}. Acione a equipe de segurança.`}</Notice></div>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input aria-label="Ação" placeholder="Ação (ex.: role.granted)" value={f.action} onChange={(e) => set('action', e.target.value)} className="w-56" />
          <Select aria-label="Resultado" value={f.outcome} onChange={(e) => set('outcome', e.target.value)} className="w-auto"><option value="">Todos os resultados</option><option value="success">Sucesso</option><option value="denied">Negado</option><option value="failure">Falha</option></Select>
          <Input aria-label="Tipo de recurso" placeholder="Recurso (user, ticket…)" value={f.resourceType} onChange={(e) => set('resourceType', e.target.value)} className="w-44" />
          <Input type="date" aria-label="De" value={f.from} onChange={(e) => set('from', e.target.value)} className="w-40" />
          <Input type="date" aria-label="Até" value={f.to} onChange={(e) => set('to', e.target.value)} className="w-40" />
        </div>
        {q.isLoading ? <Spinner /> : !q.data?.items.length ? <EmptyState title="Nenhum evento" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-xs text-fg-3"><tr><th className="px-4 py-2 font-medium">Data</th><th className="px-3 py-2 font-medium">Autor</th><th className="px-3 py-2 font-medium">Ação</th><th className="px-3 py-2 font-medium">Recurso</th><th className="px-3 py-2 font-medium">Resultado</th><th className="px-4 py-2 font-medium">Detalhes</th></tr></thead>
              <tbody>
                {q.data.items.map((e) => (
                  <tr key={e.id} className="border-t border-line align-top">
                    <td className="px-4 py-2 whitespace-nowrap text-fg-2">{formatDateTime(e.occurredAt)}</td>
                    <td className="px-3 py-2">{e.actorLabel ?? 'sistema'}<span className="block text-[11px] text-fg-3">{e.ip}</span></td>
                    <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-2 text-fg-2">{e.resourceType}<span className="block font-mono text-[10px] text-fg-3">{e.resourceId?.slice(0, 13)}</span></td>
                    <td className="px-3 py-2"><Badge tone={e.outcome === 'success' ? 'success' : e.outcome === 'denied' ? 'warning' : 'danger'}>{e.outcome}</Badge></td>
                    <td className="max-w-[360px] px-4 py-2"><code className="block truncate text-[11px] text-fg-3" title={JSON.stringify(e.metadata)}>{e.metadata ? JSON.stringify(e.metadata) : ''}</code><span className="text-[10px] text-fg-3">corr. {e.correlationId} · #{e.id}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={50} total={q.data.total} onPage={setPage} />
          </div>
        )}
      </Card>
    </AdminPage>
  );
}
