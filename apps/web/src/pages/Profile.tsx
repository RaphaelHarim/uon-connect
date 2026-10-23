import { ABSENCE_VISIBILITY_LABELS, NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, PRESENCE_LABELS, PRESENCE_STATUSES, type UserSummary } from '@uon/shared/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, LogOut, Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, Notice, PageHeader, Select, Switch, Tabs, Textarea } from '@/components/ui';
import { del, get, patch, post, put, upload } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { usePresence } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { PeoplePicker } from './Chat';

export default function ProfilePage() {
  const [tab, setTab] = useState('perfil');
  return (
    <PageContainer>
      <PageHeader title="Meu perfil" description="Seus dados, status, ausências programadas, notificações e sessões." />
      <Tabs value={tab} onValueChange={setTab} items={[{ value: 'perfil', label: 'Perfil e status' }, { value: 'ausencias', label: 'Ausências' }, { value: 'notificacoes', label: 'Notificações' }, { value: 'sessoes', label: 'Sessões' }]} />
      {tab === 'perfil' && <ProfileTab />}
      {tab === 'ausencias' && <AbsencesTab />}
      {tab === 'notificacoes' && <NotificationPrefsTab />}
      {tab === 'sessoes' && <SessionsTab />}
    </PageContainer>
  );
}

function ProfileTab() {
  const me = useMe();
  const { refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const presence = usePresence(me.user.id);
  const [name, setName] = useState(me.user.displayName);
  const [phone, setPhone] = useState(me.user.phone ?? '');
  const [status, setStatus] = useState<string>(presence?.source === 'manual' ? presence.status : '');
  const [message, setMessage] = useState(presence?.message ?? '');
  const [expires, setExpires] = useState('');
  const save = useMutation({ mutationFn: () => patch('/me', { displayName: name, phone: phone || null }), onSuccess: () => { void refresh(); toast.success('Perfil atualizado'); }, onError: (e) => toast.error('Não foi possível salvar', e) });
  const savePresence = useMutation({
    mutationFn: () => put('/me/presence', { status: status || null, message: message || null, expiresAt: status && expires ? new Date(expires).toISOString() : null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['presence'] }); toast.success('Status atualizado'); },
    onError: (e) => toast.error('Não foi possível atualizar o status', e),
  });
  const onAvatar = async (f?: File) => {
    if (!f) return;
    try {
      await upload('/me/avatar', f);
      await refresh();
      toast.success('Foto atualizada');
    } catch (e) {
      toast.error('Foto recusada', e);
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Dados pessoais" description="Departamento, equipe e cargo são mantidos pela administração." />
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-4">
            <Avatar name={me.user.displayName} src={me.user.avatarUrl} size={64} />
            <div className="flex gap-2">
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                <Camera className="size-4" aria-hidden /> Alterar foto
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void onAvatar(e.target.files?.[0])} />
              </label>
              {me.user.avatarUrl && <Button size="sm" variant="ghost" onClick={() => void del('/me/avatar').then(refresh)}>Remover</Button>}
            </div>
          </div>
          <Field label="Nome de exibição">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Telefone" hint="Visível apenas para colegas do seu departamento.">{(id, d) => <Input id={id} aria-describedby={d} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
          <Field label="E-mail">{(id) => <Input id={id} value={me.user.email} disabled />}</Field>
          <div className="flex flex-wrap gap-1.5">
            {me.departments.map((d) => <Badge key={d.id}>{d.name}</Badge>)}
            {me.teams.map((t) => <Badge key={t.id}>{t.name}{t.role === 'coordinator' ? ' · coordenação' : ''}</Badge>)}
            {me.roles.map((r) => <Badge key={r} tone="brand">{r === 'supreme_admin' ? 'Supreme Admin' : r === 'platform_admin' ? 'Administrador' : 'Auditor'}</Badge>)}
            {me.user.isFounder && <Badge tone="brand">Conta fundadora</Badge>}
          </div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Status" description="O status automático indica apenas se você está conectado, não se está trabalhando." />
        <div className="space-y-4 p-5">
          {presence && <Notice tone="neutral">Agora: <b>{PRESENCE_LABELS[presence.status]}</b> ({presence.source === 'manual' ? 'definido por você' : presence.source === 'absence' ? 'ausência programada' : 'automático'})</Notice>}
          <Field label="Status manual">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Automático (conforme conexão)</option>
                {PRESENCE_STATUSES.map((s) => <option key={s} value={s}>{s === 'offline' ? 'Aparecer offline' : PRESENCE_LABELS[s]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Mensagem de status">{(id) => <Input id={id} maxLength={140} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex.: Em vistoria até 15h" />}</Field>
          {status && <Field label="Voltar ao automático em" hint="Opcional.">{(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />}</Field>}
          <Button variant="primary" loading={savePresence.isPending} onClick={() => savePresence.mutate()}>Atualizar status</Button>
        </div>
      </Card>
    </div>
  );
}

interface Absence {
  id: string;
  startsAt: string;
  endsAt: string;
  message: string | null;
  visibility: keyof typeof ABSENCE_VISIBILITY_LABELS;
  status: 'scheduled' | 'active' | 'ended' | 'cancelled';
  substitute: UserSummary | null;
}

function AbsencesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['absences'], queryFn: () => get<Absence[]>('/me/absences') });
  const [open, setOpen] = useState(false);
  const act = (path: string, ok: string) => void post(path).then(() => { void qc.invalidateQueries({ queryKey: ['absences'] }); toast.success(ok); }).catch((e) => toast.error('Não foi possível concluir', e));
  const STATUS = { scheduled: ['Programada', 'info'], active: ['Ativa', 'warning'], ended: ['Encerrada', 'neutral'], cancelled: ['Cancelada', 'neutral'] } as const;
  return (
    <Card>
      <CardHeader title="Ausências programadas" description="Ativadas e encerradas automaticamente pelo servidor no horário definido. O substituto não ganha acesso às suas mensagens ou arquivos." actions={<Button variant="primary" onClick={() => setOpen(true)}>Programar ausência</Button>} />
      {!q.data?.length ? <EmptyState title="Nenhuma ausência programada" /> : (
        <ul className="divide-y divide-line">
          {q.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{formatDateTime(a.startsAt)} → {formatDateTime(a.endsAt)}</p>
                <p className="text-[13px] text-fg-3">{a.message ?? 'Sem mensagem'} · visível para {ABSENCE_VISIBILITY_LABELS[a.visibility].toLowerCase()}{a.substitute ? ` · substituto: ${a.substitute.displayName}` : ''}</p>
              </div>
              <Badge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge>
              {a.status === 'scheduled' && <><Button size="sm" onClick={() => act(`/me/absences/${a.id}/activate`, 'Ausência ativada')}>Ativar agora</Button><Button size="sm" variant="ghost" onClick={() => act(`/me/absences/${a.id}/end`, 'Ausência cancelada')}>Cancelar</Button></>}
              {a.status === 'active' && <Button size="sm" onClick={() => act(`/me/absences/${a.id}/end`, 'Ausência encerrada')}>Encerrar agora</Button>}
            </li>
          ))}
        </ul>
      )}
      <AbsenceDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function AbsenceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [message, setMessage] = useState('');
  const [visibility, setVisibility] = useState<'company' | 'department' | 'team'>('company');
  const [substitute, setSubstitute] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const create = useMutation({
    mutationFn: () => post('/me/absences', { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), message: message || null, visibility, substituteUserId: substitute }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['absences'] }); onOpenChange(false); toast.success('Ausência programada'); },
    onError: (e) => toast.error('Não foi possível programar', e),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Programar ausência" footer={<><Button onClick={() => onOpenChange(false)}>Cancelar</Button><Button variant="primary" disabled={!start || !end} loading={create.isPending} onClick={() => create.mutate()}>Programar</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início" required>{(id) => <Input id={id} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Término" required>{(id) => <Input id={id} type="datetime-local" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        <Field label="Mensagem">{(id) => <Textarea id={id} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex.: Em férias. Assuntos urgentes com…" />}</Field>
        <Field label="Quem pode ver a mensagem e o substituto">
          {(id) => <Select id={id} value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>{Object.entries(ABSENCE_VISIBILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Contato substituto (opcional)</p>
          <div className="flex gap-2"><Button size="sm" onClick={() => setPicker(true)}>{substitute ? 'Alterar substituto' : 'Escolher substituto'}</Button>{substitute && <Button size="sm" variant="ghost" onClick={() => setSubstitute(null)}>Remover</Button>}</div>
        </div>
      </div>
      <PeoplePicker open={picker} onOpenChange={setPicker} single title="Contato substituto" confirmLabel="Escolher" onConfirm={(ids) => setSubstitute(ids[0] ?? null)} />
    </Dialog>
  );
}

function NotificationPrefsTab() {
  const me = useMe();
  const { refresh } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState(me.preferences.notifications);
  const save = useMutation({ mutationFn: () => put('/me/preferences', { notifications: prefs }), onSuccess: () => { void refresh(); toast.success('Preferências salvas'); }, onError: (e) => toast.error('Não foi possível salvar', e) });
  return (
    <Card>
      <CardHeader title="Preferências de notificação" description="E-mails contêm apenas o título e um link — nunca o conteúdo de mensagens ou chamados." />
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-fg-3"><th className="px-5 py-2 font-medium">Categoria</th><th className="px-3 py-2 text-center font-medium">No aplicativo</th><th className="px-5 py-2 text-center font-medium">Por e-mail</th></tr></thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <tr key={c} className="border-t border-line">
                <td className="px-5 py-2.5">{NOTIFICATION_CATEGORY_LABELS[c]}</td>
                <td className="px-3 py-2.5 text-center"><Switch label={`${NOTIFICATION_CATEGORY_LABELS[c]} no aplicativo`} checked={prefs[c]?.inApp ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, [c]: { inApp: v, email: prefs[c]?.email ?? false } })} /></td>
                <td className="px-5 py-2.5 text-center"><Switch label={`${NOTIFICATION_CATEGORY_LABELS[c]} por e-mail`} checked={prefs[c]?.email ?? false} onCheckedChange={(v) => setPrefs({ ...prefs, [c]: { inApp: prefs[c]?.inApp ?? true, email: v } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-5 py-3"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar preferências</Button></div>
    </Card>
  );
}

function SessionsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => get<{ id: string; authMethod: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; revokedAt: string | null; revokedReason: string | null; current: boolean }[]>('/me/sessions') });
  const revoke = (id: string) => void del(`/me/sessions/${id}`).then(() => { void qc.invalidateQueries({ queryKey: ['sessions'] }); toast.success('Sessão encerrada'); }).catch((e) => toast.error('Não foi possível encerrar', e));
  return (
    <Card>
      <CardHeader title="Sessões" description="Dispositivos em que você entrou recentemente. Encerre as que não reconhecer." />
      <ul className="divide-y divide-line">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
            {/Mobile|Android|iPhone/i.test(s.userAgent ?? '') ? <Smartphone className="size-4 text-fg-3" aria-hidden /> : <Monitor className="size-4 text-fg-3" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{(s.userAgent ?? 'Dispositivo desconhecido').slice(0, 80)}</p>
              <p className="text-fg-3">{s.authMethod === 'entra' ? 'Microsoft' : 'Desenvolvimento'} · IP {s.ip ?? '—'} · início {formatDateTime(s.createdAt)} · atividade {formatRelative(s.lastSeenAt)}</p>
            </div>
            {s.current ? <Badge tone="success">Esta sessão</Badge> : s.revokedAt ? <Badge>Encerrada</Badge> : <Button size="sm" icon={<LogOut className="size-4" />} onClick={() => revoke(s.id)}>Encerrar</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
