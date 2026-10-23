import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Switch, Textarea } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { OrgStructure } from '../Org';
import { AdminPage } from './common';

type Editing =
  | { kind: 'department'; id?: string; name: string; description: string; acceptsTickets: boolean; active: boolean }
  | { kind: 'team'; id?: string; departmentId: string; name: string; description: string; clientId: string; active: boolean }
  | { kind: 'client'; id?: string; name: string; active: boolean };

export default function AdminOrg() {
  const q = useQuery({ queryKey: ['org'], queryFn: () => get<OrgStructure>('/org/structure') });
  const [editing, setEditing] = useState<Editing | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (e: Editing) => {
      const base = e.kind === 'department' ? '/admin/departments' : e.kind === 'team' ? '/admin/teams' : '/admin/clients';
      const body = e.kind === 'department' ? { name: e.name, description: e.description || null, acceptsTickets: e.acceptsTickets, active: e.active }
        : e.kind === 'team' ? { departmentId: e.departmentId, name: e.name, description: e.description || null, clientId: e.clientId || null, active: e.active }
        : { name: e.name, active: e.active };
      return e.id ? put(`${base}/${e.id}`, body) : post(base, body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['org'] }); setEditing(null); toast.success('Estrutura atualizada'); },
    onError: (e) => toast.error('Não foi possível salvar', e),
  });
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <AdminPage permission="org.manage" title="Estrutura organizacional" description="Nomes e estrutura são configuráveis; novas carteiras de clientes não exigem alteração de código." actions={<><Button icon={<Plus className="size-4" />} onClick={() => setEditing({ kind: 'client', name: '', active: true })}>Novo cliente</Button><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ kind: 'department', name: '', description: '', acceptsTickets: false, active: true })}>Novo departamento</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {d.departments.map((dep) => (
            <Card key={dep.id}>
              <CardHeader
                title={<span className="flex items-center gap-2">{dep.name}{!dep.active && <Badge tone="danger">Inativo</Badge>}{dep.acceptsTickets && <Badge tone="info">Recebe chamados</Badge>}</span>}
                description={`Responsável: ${dep.heads.map((h) => h.displayName).join(', ') || 'configuração pendente (defina em Usuários)'}`}
                actions={<><Button size="sm" onClick={() => setEditing({ kind: 'team', departmentId: dep.id, name: '', description: '', clientId: '', active: true })}>Nova equipe</Button><Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'department', id: dep.id, name: dep.name, description: dep.description ?? '', acceptsTickets: dep.acceptsTickets, active: dep.active })}>Editar</Button></>}
              />
              <ul className="divide-y divide-line">
                {dep.teams.length === 0 && <li className="px-5 py-3 text-[13px] text-fg-3">Sem equipes.</li>}
                {dep.teams.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[13px]">
                    <span className="font-medium">{t.name}</span>
                    {t.clientName && <Badge tone="brand">{t.clientName}</Badge>}
                    {!t.active && <Badge tone="danger">Inativa</Badge>}
                    <span className="text-fg-3">· {t.memberCount} pessoas · coordenação: {t.coordinators.map((c) => c.displayName).join(', ') || 'pendente'}</span>
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ kind: 'team', id: t.id, departmentId: dep.id, name: t.name, description: t.description ?? '', clientId: t.clientId ?? '', active: t.active })}>Editar</Button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader title="Clientes / carteiras" />
          <ul className="divide-y divide-line">
            {d.clients.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-5 py-2.5 text-[13px]">
                <span className="flex-1 font-medium">{c.name}</span>{!c.active && <Badge tone="danger">Inativo</Badge>}
                <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'client', id: c.id, name: c.name, active: c.active })}>Editar</Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(null)} title={`${editing.id ? 'Editar' : 'Novo'} ${editing.kind === 'department' ? 'departamento' : editing.kind === 'team' ? 'equipe' : 'cliente'}`} footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={editing.name.trim().length < 2} onClick={() => save.mutate(editing)}>Salvar</Button></>}>
          <div className="space-y-4">
            <Field label="Nome" required>{(id) => <Input id={id} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}</Field>
            {editing.kind !== 'client' && <Field label="Descrição">{(id) => <Textarea id={id} rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />}</Field>}
            {editing.kind === 'team' && (
              <>
                <Field label="Departamento">{(id) => <Select id={id} value={editing.departmentId} onChange={(e) => setEditing({ ...editing, departmentId: e.target.value })}>{d.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
                <Field label="Carteira de cliente (opcional)">{(id) => <Select id={id} value={editing.clientId} onChange={(e) => setEditing({ ...editing, clientId: e.target.value })}><option value="">Nenhuma</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
              </>
            )}
            {editing.kind === 'department' && <label className="flex items-center gap-2 text-[13px]"><Switch label="Recebe chamados" checked={editing.acceptsTickets} onCheckedChange={(v) => setEditing({ ...editing, acceptsTickets: v })} /> Possui central de atendimento (recebe chamados de toda a empresa)</label>}
            <label className="flex items-center gap-2 text-[13px]"><Switch label="Ativo" checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> Ativo</label>
          </div>
        </Dialog>
      )}
    </AdminPage>
  );
}
