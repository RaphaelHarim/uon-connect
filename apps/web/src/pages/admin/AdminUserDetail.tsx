import { DEPARTMENT_ROLE_LABELS, DEPARTMENT_ROLES, PLATFORM_ROLES, type PlatformRole, TEAM_ROLE_LABELS, TEAM_ROLES, USER_STATUS_LABELS } from '@uon/shared/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, Field, Input, Notice, Select, Spinner, Textarea } from '@/components/ui';
import { del, get, patch, post, put } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { OrgStructure } from '../Org';
import { AdminPage, ROLE_LABELS } from './common';

interface Detail {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  avatarUrl: string | null;
  status: 'active' | 'inactive' | 'offboarded';
  isFounder: boolean;
  isDemo: boolean;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  createdAt: string;
  roles: { role: PlatformRole; grantedAt: string }[];
  identities: { provider: string; tenantId: string; subject: string; lastLoginAt: string | null }[];
  departments: { departmentId: string; name: string; role: string }[];
  teams: { teamId: string; name: string; role: string; departmentName: string }[];
  activeSessions: number;
  history: { id: number; occurredAt: string; action: string; actorLabel: string | null; outcome: string; metadata: Record<string, unknown> | null }[];
}

interface Access {
  roles: string[];
  permissions: string[];
  contentAccessNote: string;
  scopes: Record<'headOf' | 'serviceDeskOf' | 'coordinatorOf' | 'oversees' | 'memberOf', { id: string; name: string }[]>;
  conflicts: string[];
}

export default function AdminUserDetail() {
  const { id } = useParams();
  const me = useMe();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => get<Detail>(`/admin/users/${id}`) });
  const access = useQuery({ queryKey: ['admin', 'user', id, 'access'], queryFn: () => get<Access>(`/admin/users/${id}/effective-access`) });
  const org = useQuery({ queryKey: ['org'], queryFn: () => get<OrgStructure>('/org/structure') });
  const [statusOpen, setStatusOpen] = useState<null | 'active' | 'inactive' | 'offboarded'>(null);
  const [reason, setReason] = useState('');
  const [deptSel, setDeptSel] = useState({ id: '', role: 'member' });
  const [teamSel, setTeamSel] = useState({ id: '', role: 'member' });
  const [edit, setEdit] = useState<{ displayName: string; jobTitle: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'user', id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
  const run = (p: Promise<unknown>, ok: string) => p.then(() => { refresh(); toast.success(ok); }).catch((e) => toast.error('Operação recusada', e));
  const changeStatus = useMutation({ mutationFn: (s: string) => post(`/admin/users/${id}/status`, { status: s, reason: reason || undefined }), onSuccess: () => { setStatusOpen(null); setReason(''); refresh(); toast.success('Status atualizado'); }, onError: (e) => toast.error('Operação recusada', e) });

  if (q.error) return <AdminPage permission="users.manage" title="Usuário"><ErrorState error={q.error} /></AdminPage>;
  if (!q.data) return <Spinner />;
  const u = q.data;
  const self = u.id === me.user.id;
  const protectedAccount = u.isFounder;
  const grantable = PLATFORM_ROLES.filter((r) => can(`roles.grant.${r}` as never) && !u.roles.some((x) => x.role === r));
  const allTeams = org.data?.departments.flatMap((d) => d.teams.map((t) => ({ ...t, departmentName: d.name }))) ?? [];

  return (
    <AdminPage permission="users.manage" title={u.displayName} description={u.email}>
      {protectedAccount && (
        <div className="mb-5"><Notice tone="brand" icon={<ShieldCheck className="size-4" />} title="Conta fundadora protegida">Não pode ser desativada, rebaixada, excluída ou reassociada por operações administrativas — nem por outros Supreme Admins. Alterações excepcionais seguem o procedimento formal de recuperação (docs/RECOVERY.md).</Notice></div>
      )}
      {self && <div className="mb-5"><Notice tone="neutral">Esta é a sua conta. Alterações administrativas nela precisam ser feitas por outro administrador.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Conta" actions={!protectedAccount && !self && <Button size="sm" onClick={() => setEdit({ displayName: u.displayName, jobTitle: u.jobTitle ?? '' })}>Editar</Button>} />
            <div className="flex flex-wrap items-center gap-4 p-5">
              <Avatar name={u.displayName} src={u.avatarUrl} size={56} />
              <div className="min-w-0 flex-1 text-[13px]">
                <p className="font-medium">{u.jobTitle ?? 'Sem cargo'}</p>
                <p className="text-fg-3">Criado em {formatDateTime(u.createdAt)} · {u.activeSessions} sessão(ões) ativa(s)</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{USER_STATUS_LABELS[u.status]}</Badge>
                  {u.isDemo && <Badge tone="info">Demonstração</Badge>}
                  {u.identities.map((i) => <Badge key={i.provider} icon={<KeyRound className="size-3" />}>{i.provider === 'entra' ? `Entra ID (${i.subject})` : 'Login de desenvolvimento'}</Badge>)}
                  {!u.identities.some((i) => i.provider === 'entra') && <Badge>Sem identidade Entra associada</Badge>}
                </div>
                {u.deactivationReason && <p className="mt-1 text-fg-3">Motivo da desativação: {u.deactivationReason}</p>}
              </div>
              {!protectedAccount && !self && (
                <div className="flex flex-wrap gap-2">
                  {u.status === 'active' ? (
                    <><Button size="sm" onClick={() => setStatusOpen('inactive')}>Desativar</Button><Button size="sm" variant="ghost" onClick={() => setStatusOpen('offboarded')}>Desligar</Button></>
                  ) : <Button size="sm" variant="primary" onClick={() => setStatusOpen('active')}>Reativar</Button>}
                  {can('sessions.revoke') && <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void run(post(`/admin/users/${id}/revoke-sessions`), 'Sessões encerradas')}>Encerrar sessões</Button>}
                </div>
              )}
            </div>
            {edit && (
              <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
                <Field label="Nome">{(fid) => <Input id={fid} value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />}</Field>
                <Field label="Cargo">{(fid) => <Input id={fid} value={edit.jobTitle} onChange={(e) => setEdit({ ...edit, jobTitle: e.target.value })} />}</Field>
                <div className="flex gap-2 sm:col-span-2"><Button variant="primary" onClick={() => void run(patch(`/admin/users/${id}`, { displayName: edit.displayName, jobTitle: edit.jobTitle || null }), 'Dados atualizados').then(() => setEdit(null))}>Salvar</Button><Button onClick={() => setEdit(null)}>Cancelar</Button></div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Vínculos organizacionais" description="Definem o que a pessoa pode ver e atender (escopos)." />
            <div className="space-y-5 p-5">
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-fg-3 uppercase">Departamentos</p>
                <ul className="space-y-1.5">
                  {u.departments.map((d) => (
                    <li key={d.departmentId} className="flex items-center gap-2 text-[13px]">
                      <span className="flex-1 font-medium">{d.name}</span>
                      <Badge>{DEPARTMENT_ROLE_LABELS[d.role as keyof typeof DEPARTMENT_ROLE_LABELS]}</Badge>
                      {!protectedAccount && !self && <Button size="icon" variant="ghost" aria-label={`Remover de ${d.name}`} onClick={() => void run(del(`/admin/users/${id}/departments/${d.departmentId}`), 'Vínculo removido')}><Trash2 className="size-4" /></Button>}
                    </li>
                  ))}
                  {u.departments.length === 0 && <li className="text-[13px] text-fg-3">Nenhum vínculo direto.</li>}
                </ul>
                {!protectedAccount && !self && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Select aria-label="Departamento" value={deptSel.id} onChange={(e) => setDeptSel({ ...deptSel, id: e.target.value })} className="w-auto flex-1"><option value="">Departamento…</option>{org.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
                    <Select aria-label="Papel no departamento" value={deptSel.role} onChange={(e) => setDeptSel({ ...deptSel, role: e.target.value })} className="w-auto">{DEPARTMENT_ROLES.map((r) => <option key={r} value={r}>{DEPARTMENT_ROLE_LABELS[r]}</option>)}</Select>
                    <Button disabled={!deptSel.id} onClick={() => void run(put(`/admin/users/${id}/departments`, { departmentId: deptSel.id, role: deptSel.role }), 'Vínculo salvo')}>Salvar</Button>
                  </div>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-fg-3 uppercase">Equipes e carteiras</p>
                <ul className="space-y-1.5">
                  {u.teams.map((t) => (
                    <li key={t.teamId} className="flex items-center gap-2 text-[13px]">
                      <span className="flex-1"><span className="font-medium">{t.name}</span> <span className="text-fg-3">· {t.departmentName}</span></span>
                      <Badge>{TEAM_ROLE_LABELS[t.role as keyof typeof TEAM_ROLE_LABELS]}</Badge>
                      {!protectedAccount && !self && <Button size="icon" variant="ghost" aria-label={`Remover de ${t.name}`} onClick={() => void run(del(`/admin/users/${id}/teams/${t.teamId}`), 'Vínculo removido')}><Trash2 className="size-4" /></Button>}
                    </li>
                  ))}
                  {u.teams.length === 0 && <li className="text-[13px] text-fg-3">Nenhuma equipe.</li>}
                </ul>
                {!protectedAccount && !self && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Select aria-label="Equipe" value={teamSel.id} onChange={(e) => setTeamSel({ ...teamSel, id: e.target.value })} className="w-auto flex-1"><option value="">Equipe…</option>{allTeams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.departmentName})</option>)}</Select>
                    <Select aria-label="Papel na equipe" value={teamSel.role} onChange={(e) => setTeamSel({ ...teamSel, role: e.target.value })} className="w-auto">{TEAM_ROLES.map((r) => <option key={r} value={r}>{TEAM_ROLE_LABELS[r]}</option>)}</Select>
                    <Button disabled={!teamSel.id} onClick={() => void run(put(`/admin/users/${id}/teams`, { teamId: teamSel.id, role: teamSel.role }), 'Vínculo salvo')}>Salvar</Button>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Histórico de alterações" description="Extraído do registro de auditoria." />
            <ul className="divide-y divide-line text-[13px]">
              {u.history.length === 0 && <li className="px-5 py-4 text-fg-3">Sem registros.</li>}
              {u.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-3 px-5 py-2">
                  <span className="w-36 shrink-0 text-fg-3">{formatDateTime(h.occurredAt)}</span>
                  <span className="font-mono text-xs">{h.action}</span>
                  <Badge tone={h.outcome === 'success' ? 'neutral' : 'danger'}>{h.outcome}</Badge>
                  <span className="text-fg-3">por {h.actorLabel ?? 'sistema'}</span>
                  {h.metadata && <span className="w-full truncate font-mono text-[11px] text-fg-3">{JSON.stringify(h.metadata)}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Funções da plataforma" />
            <div className="space-y-2 p-5">
              {u.roles.length === 0 && <p className="text-[13px] text-fg-3">Colaborador sem funções administrativas.</p>}
              {u.roles.map((r) => (
                <div key={r.role} className="flex items-center gap-2 text-[13px]">
                  <Badge tone="info">{ROLE_LABELS[r.role]}</Badge>
                  <span className="text-xs text-fg-3">desde {formatDateTime(r.grantedAt)}</span>
                  {!protectedAccount && !self && can(`roles.grant.${r.role}` as never) && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void run(del(`/admin/users/${id}/roles/${r.role}`), 'Função removida')}>Remover</Button>}
                </div>
              ))}
              {!self && u.status === 'active' && grantable.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {grantable.map((r) => <Button key={r} size="sm" onClick={() => void run(post(`/admin/users/${id}/roles`, { role: r }), `${ROLE_LABELS[r]} concedida`)}>Conceder {ROLE_LABELS[r]}</Button>)}
                </div>
              )}
              {!can('roles.grant.supreme_admin') && <p className="pt-1 text-xs text-fg-3">Somente a conta fundadora designa ou remove Supreme Admins.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Acesso efetivo" />
            {access.data && (
              <div className="space-y-4 p-5 text-[13px]">
                {access.data.conflicts.length > 0 && <Notice tone="warning" icon={<AlertTriangle className="size-4" />} title="Configurações a revisar"><ul className="list-disc pl-4">{access.data.conflicts.map((c) => <li key={c}>{c}</li>)}</ul></Notice>}
                <p className="text-xs text-fg-3">{access.data.contentAccessNote}</p>
                {([['headOf', 'Responsável por'], ['serviceDeskOf', 'Atende a central de'], ['coordinatorOf', 'Coordena'], ['oversees', 'Supervisiona as equipes'], ['memberOf', 'Membro de']] as const).map(([k, label]) => (
                  <div key={k}><p className="text-xs text-fg-3">{label}</p><p>{access.data!.scopes[k].map((s) => s.name).join(', ') || '—'}</p></div>
                ))}
                <div><p className="text-xs text-fg-3">Permissões administrativas</p><div className="mt-1 flex flex-wrap gap-1">{access.data.permissions.length ? access.data.permissions.map((p) => <code key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">{p}</code>) : '—'}</div></div>
              </div>
            )}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={!!statusOpen}
        onOpenChange={(v) => !v && setStatusOpen(null)}
        title={statusOpen === 'active' ? 'Reativar conta?' : statusOpen === 'offboarded' ? 'Registrar desligamento?' : 'Desativar conta?'}
        description={statusOpen === 'active' ? 'A pessoa poderá entrar novamente.' : 'As sessões serão encerradas imediatamente. Chamados, mensagens e auditoria são preservados.'}
        tone={statusOpen === 'active' ? 'primary' : 'danger'}
        loading={changeStatus.isPending}
        onConfirm={() => statusOpen && changeStatus.mutate(statusOpen)}
      >
        {statusOpen !== 'active' && <Field label="Motivo">{(fid) => <Textarea id={fid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
      </ConfirmDialog>
    </AdminPage>
  );
}
