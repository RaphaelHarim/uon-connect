import { PLATFORM_ROLES, USER_STATUS_LABELS } from '@uon/shared/browser';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Avatar, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, Pagination, Select, Spinner, Textarea } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { AdminPage, ROLE_LABELS } from './common';

interface Row {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  status: 'active' | 'inactive' | 'offboarded';
  isDemo: boolean;
  isFounder: boolean;
  roles: string[];
  org: { departmentName: string; teamName: string | null; role: string }[];
}

export default function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? '';
  const role = params.get('role') ?? '';
  const list = useQuery({
    queryKey: ['admin', 'users', q, page, status, role],
    queryFn: () => get<{ items: Row[]; total: number }>(`/admin/users?pageSize=25&page=${page}&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}${role ? `&role=${role}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const set = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); p.delete('page'); return p; }, { replace: true });

  return (
    <AdminPage permission="users.manage" title="Usuários e permissões" description="Contas nunca são excluídas: ao desativar, o histórico é preservado e as sessões são encerradas." actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>Novo usuário</Button>}>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou e-mail" aria-label="Pesquisar usuários" className="pl-9" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} className="w-auto">
            <option value="">Todos os status</option>
            {Object.entries(USER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Função" value={role} onChange={(e) => set('role', e.target.value)} className="w-auto">
            <option value="">Todas as funções</option>
            {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          {selected.size > 0 && <Button onClick={() => setBulkOpen(true)}>Alterar status de {selected.size}</Button>}
        </div>
        {list.isLoading ? <Spinner /> : list.error ? <ErrorState error={list.error} /> : list.data!.items.length === 0 ? <EmptyState title="Nenhum usuário encontrado" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-fg-3">
                <tr>
                  <th className="w-10 px-4 py-2.5"><span className="sr-only">Selecionar</span></th>
                  <th className="px-2 py-2.5 font-medium">Usuário</th>
                  <th className="px-3 py-2.5 font-medium">Vínculos</th>
                  <th className="px-3 py-2.5 font-medium">Funções</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data!.items.map((u) => (
                  <tr key={u.id} className="border-t border-line hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <input type="checkbox" aria-label={`Selecionar ${u.displayName}`} disabled={u.isFounder} checked={selected.has(u.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} className="size-4 accent-[var(--brand)]" />
                    </td>
                    <td className="px-2 py-2.5">
                      <Link to={`/admin/usuarios/${u.id}`} className="flex items-center gap-2.5 hover:underline">
                        <Avatar name={u.displayName} src={u.avatarUrl} size={30} />
                        <span><span className="block font-medium">{u.displayName}</span><span className="block text-xs text-fg-3">{u.email}</span></span>
                      </Link>
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2.5 text-fg-2">{u.org.map((o) => o.teamName ?? o.departmentName).join(', ') || <span className="text-fg-3">—</span>}</td>
                    <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{u.isFounder && <Badge tone="brand">Fundadora</Badge>}{u.roles.map((r) => <Badge key={r} tone="info">{ROLE_LABELS[r]}</Badge>)}{u.isDemo && <Badge>Demo</Badge>}</div></td>
                    <td className="px-4 py-2.5"><Badge tone={u.status === 'active' ? 'success' : 'danger'}>{USER_STATUS_LABELS[u.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={25} total={list.data!.total} onPage={(n) => setParams((p) => { p.set('page', String(n)); return p; })} />
          </div>
        )}
      </Card>
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <BulkStatusDialog open={bulkOpen} onOpenChange={setBulkOpen} ids={[...selected]} onDone={() => setSelected(new Set())} />
    </AdminPage>
  );
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setName] = useState('');
  const [jobTitle, setJob] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/admin/users', { email, displayName, jobTitle: jobTitle || null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'users'] }); onOpenChange(false); toast.success('Usuário criado', 'No primeiro login pelo Entra ID a conta será associada pelo identificador do diretório.'); },
    onError: (e) => toast.error('Não foi possível criar', e),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Novo usuário" description="O usuário é pré-cadastrado sem funções. Vínculos e permissões são definidos depois." footer={<><Button onClick={() => onOpenChange(false)}>Cancelar</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Criar</Button></>}>
      <div className="space-y-4">
        <Field label="E-mail corporativo" required>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Nome" required>{(id) => <Input id={id} value={displayName} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Cargo">{(id) => <Input id={id} value={jobTitle} onChange={(e) => setJob(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function BulkStatusDialog({ open, onOpenChange, ids, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; ids: string[]; onDone: () => void }) {
  const [status, setStatus] = useState<'active' | 'inactive' | 'offboarded'>('inactive');
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const run = useMutation({
    mutationFn: () => post<{ results: { ok: boolean; message?: string }[] }>('/admin/users/bulk-status', { userIds: ids, status, reason: reason || undefined }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onOpenChange(false);
      onDone();
      if (failed.length) toast.error(`${failed.length} conta(s) não alterada(s)`, failed.map((f) => f.message).join('\n'));
      else toast.success('Status atualizado');
    },
    onError: (e) => toast.error('Falha na operação em lote', e),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Alterar status de ${ids.length} conta(s)`} description="Cada conta passa pelas mesmas regras de proteção das operações individuais." footer={<><Button onClick={() => onOpenChange(false)}>Cancelar</Button><Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>Aplicar</Button></>}>
      <div className="space-y-4">
        <Field label="Novo status">{(id) => <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>{Object.entries(USER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Motivo">{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
