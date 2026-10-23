import { ABSENCE_VISIBILITY_LABELS, NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, PRESENCE_LABELS, PRESENCE_STATUSES, type UserSummary } from '@uon/shared/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner, Switch, Tabs, Textarea } from '@/components/ui';
import { del, get, patch, post, put, upload } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { usePresence } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { PeoplePicker } from './Chat';

interface SecurityInfo {
  localAuthEnabled: boolean;
  adminMfaRequired: boolean;
  adminMfaPending: boolean;
  local: { hasPassword: boolean; passwordChangedAt: string | null; mfaEnabled: boolean; mfaEnabledAt: string | null } | null;
}

export default function ProfilePage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('aba') ?? 'perfil');
  const security = useQuery({ queryKey: ['me-security'], queryFn: () => get<SecurityInfo>('/me/security') });
  const showSecurity = !!security.data?.local?.hasPassword;
  return (
    <PageContainer>
      <PageHeader title="Meu perfil" description="Seus dados, status, ausências programadas, notificações e sessões." />
      <Tabs value={tab} onValueChange={setTab} items={[
          { value: 'perfil', label: 'Perfil e status' },
          { value: 'ausencias', label: 'Ausências' },
          { value: 'notificacoes', label: 'Notificações' },
          ...(showSecurity ? [{ value: 'seguranca', label: 'Senha e 2FA' }] : []),
          { value: 'sessoes', label: 'Sessões' },
        ]}
      />
      {tab === 'perfil' && <ProfileTab />}
      {tab === 'ausencias' && <AbsencesTab />}
      {tab === 'notificacoes' && <NotificationPrefsTab />}
      {tab === 'seguranca' && showSecurity && <SecurityTab info={security.data!} />}
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
              <p className="text-fg-3">{s.authMethod === 'entra' ? 'Microsoft' : s.authMethod === 'local' ? 'Usuário e senha' : 'Desenvolvimento'} · IP {s.ip ?? '—'} · início {formatDateTime(s.createdAt)} · atividade {formatRelative(s.lastSeenAt)}</p>
            </div>
            {s.current ? <Badge tone="success">Esta sessão</Badge> : s.revokedAt ? <Badge>Encerrada</Badge> : <Button size="sm" icon={<LogOut className="size-4" />} onClick={() => revoke(s.id)}>Encerrar</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SecurityTab({ info }: { info: SecurityInfo }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChangePasswordCard changedAt={info.local?.passwordChangedAt ?? null} />
      <MfaCard enabled={!!info.local?.mfaEnabled} adminPending={info.adminMfaPending} />
    </div>
  );
}

function ChangePasswordCard({ changedAt }: { changedAt: string | null }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== next;
  const save = useMutation({
    mutationFn: () => post<{ revokedSessions: number }>('/me/password', { currentPassword: current, newPassword: next }),
    onSuccess: (r) => {
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success(r.revokedSessions > 0 ? `Senha alterada. ${r.revokedSessions} outra(s) sessão(ões) encerrada(s).` : 'Senha alterada');
    },
  });
  return (
    <Card>
      <CardHeader title="Senha" description={changedAt ? `Última alteração: ${formatDateTime(changedAt)}` : undefined} />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) save.mutate();
        }}
      >
        <Field label="Senha atual" required>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}
        </Field>
        <Field label="Nova senha" hint="Pelo menos 12 caracteres." required>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />}
        </Field>
        <Field label="Confirme a nova senha" error={mismatch ? 'As senhas não coincidem.' : undefined} required>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        {save.error && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <Button type="submit" variant="primary" icon={<KeyRound className="size-4" />} loading={save.isPending} disabled={!current || !next || mismatch}>
          Alterar senha
        </Button>
      </form>
    </Card>
  );
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import('qrcode').then((q) => q.toDataURL(value, { margin: 1, width: 192 })).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [value]);
  return src ? <img src={src} width={192} height={192} alt="QR code para configurar o aplicativo autenticador" className="rounded-lg border border-line bg-white" /> : <Spinner />;
}

function MfaCard({ enabled, adminPending }: { enabled: boolean; adminPending: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState('');
  const done = async (msg: string) => {
    setSetup(null);
    setCode('');
    setPassword('');
    setDisableOpen(false);
    await qc.invalidateQueries({ queryKey: ['me-security'] });
    await refresh();
    toast.success(msg);
  };
  const start = useMutation({ mutationFn: () => post<{ secret: string; otpauthUri: string }>('/me/mfa/setup'), onSuccess: setSetup, onError: (e) => toast.error('Não foi possível iniciar', e) });
  const enable = useMutation({ mutationFn: () => post('/me/mfa/enable', { code }), onSuccess: () => done('Verificação em duas etapas ativada') });
  const disable = useMutation({ mutationFn: () => post('/me/mfa/disable', { password, code }), onSuccess: () => done('Verificação em duas etapas desativada') });
  const codeInput = (id: string, d?: string) => (
    <Input id={id} aria-describedby={d} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-32" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
  );

  return (
    <Card>
      <CardHeader
        title="Verificação em duas etapas"
        description="Além da senha, pede um código de 6 dígitos gerado no celular (Microsoft Authenticator, Google Authenticator ou similar)."
        actions={enabled ? <Badge tone="success" icon={<ShieldCheck className="size-3.5" />}>Ativa</Badge> : <Badge>Desativada</Badge>}
      />
      <div className="space-y-4 p-5">
        {adminPending && (
          <Notice tone="warning" title="Necessária para funções administrativas">
            Sua conta tem uma função administrativa. Ela só fica disponível depois que você ativar a verificação em duas etapas.
          </Notice>
        )}
        {!enabled && !setup && (
          <Button variant="primary" icon={<Smartphone className="size-4" />} loading={start.isPending} onClick={() => start.mutate()}>
            Configurar no celular
          </Button>
        )}
        {setup && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <ol className="list-decimal space-y-2 pl-5 text-[13px] text-fg-2">
              <li>No aplicativo autenticador, adicione uma conta e leia o QR code.</li>
              <li>Digite abaixo o código de 6 dígitos que aparecer.</li>
            </ol>
            <QrImage value={setup.otpauthUri} />
            <p className="text-[12px] text-fg-3">
              Sem câmera? Digite a chave: <code className="font-mono break-all text-fg select-all">{setup.secret}</code>
            </p>
            <Field label="Código de 6 dígitos" required>
              {codeInput}
            </Field>
            {enable.error && <Notice tone="danger">{(enable.error as Error).message}</Notice>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={enable.isPending} disabled={code.length !== 6}>
                Ativar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
        {enabled && (
          <>
            <p className="text-[13px] text-fg-2">Se trocar de celular, desative e configure de novo. Se perder o celular, peça à administração para redefinir.</p>
            <Button variant="secondary" onClick={() => setDisableOpen(true)}>
              Desativar
            </Button>
          </>
        )}
      </div>
      <Dialog open={disableOpen} onOpenChange={setDisableOpen} title="Desativar a verificação em duas etapas" description="Confirme com sua senha e um código atual do aplicativo.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
        >
          <Field label="Senha" required>
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Field>
          <Field label="Código de 6 dígitos" required>
            {codeInput}
          </Field>
          {disable.error && <Notice tone="danger">{(disable.error as Error).message}</Notice>}
          <Button type="submit" variant="danger" loading={disable.isPending} disabled={!password || code.length !== 6}>
            Desativar
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
