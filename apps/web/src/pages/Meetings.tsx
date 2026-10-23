import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, ExternalLink, Plus, Video, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, Notice, Select, Spinner, Tabs } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatTime } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { PeoplePicker } from './Chat';

interface MeetingItem {
  id: string;
  title: string;
  provider: 'webrtc' | 'teams';
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  scheduledStartAt: string | null;
  externalJoinUrl: string | null;
  me: { role: string; inviteStatus: 'invited' | 'accepted' | 'declined' };
  participantCount: number;
}

const STATUS: Record<MeetingItem['status'], { label: string; tone: 'success' | 'neutral' | 'info' | 'danger' }> = {
  live: { label: 'Em andamento', tone: 'success' },
  scheduled: { label: 'Agendada', tone: 'info' },
  ended: { label: 'Encerrada', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
};

export default function MeetingsPage() {
  const [range, setRange] = useState<'upcoming' | 'past'>('upcoming');
  const [createOpen, setCreateOpen] = useState(false);
  const { config } = useAuth();
  const q = useQuery({ queryKey: ['meetings', range], queryFn: () => get<MeetingItem[]>(`/meetings?range=${range}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const respond = useMutation({
    mutationFn: (v: { id: string; response: 'accepted' | 'declined' }) => post(`/meetings/${v.id}/respond`, { response: v.response }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
    onError: (e) => toast.error('Não foi possível responder', e),
  });

  return (
    <PageContainer>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Reuniões e chamadas</h1>
          <p className="mt-1 text-sm text-fg-2">Chamadas de vídeo da plataforma (até {config?.calls.maxParticipants ?? 6} pessoas) e reuniões agendadas.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>Nova reunião</Button>
      </div>
      <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)} items={[{ value: 'upcoming', label: 'Próximas e em andamento' }, { value: 'past', label: 'Anteriores' }]} />
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.length === 0 ? (
          <EmptyState icon={<CalendarClock className="size-5" />} title={range === 'upcoming' ? 'Nenhuma reunião próxima' : 'Nenhuma reunião anterior'} description="Inicie uma chamada a partir de uma conversa ou agende uma reunião." />
        ) : (
          <ul className="divide-y divide-line">
            {q.data!.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-2">
                  {m.provider === 'teams' ? <ExternalLink className="size-4" aria-hidden /> : <Video className="size-4" aria-hidden />}
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/reunioes/${m.id}`} className="block truncate text-sm font-medium hover:underline">{m.title}</Link>
                  <p className="text-xs text-fg-3">
                    {m.scheduledStartAt ? formatDateTime(m.scheduledStartAt) : '—'} · {m.participantCount} participantes · {m.provider === 'teams' ? 'Microsoft Teams' : 'Chamada da plataforma'}
                  </p>
                </div>
                <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                {m.me.inviteStatus === 'invited' && m.status !== 'ended' && m.status !== 'cancelled' && (
                  <div className="flex gap-1.5">
                    <Button size="sm" icon={<Check className="size-4" />} onClick={() => respond.mutate({ id: m.id, response: 'accepted' })}>Aceitar</Button>
                    <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => respond.mutate({ id: m.id, response: 'declined' })}>Recusar</Button>
                  </div>
                )}
                {m.me.inviteStatus === 'declined' && <Badge>Recusada</Badge>}
                {(m.status === 'live' || m.status === 'scheduled') && m.me.inviteStatus !== 'declined' && (
                  <Link to={`/reunioes/${m.id}`}><Button size="sm" variant={m.status === 'live' ? 'primary' : 'secondary'}>Entrar</Button></Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <OutlookCalendar />
      <CreateMeetingDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageContainer>
  );
}

function OutlookCalendar() {
  const { config } = useAuth();
  const from = new Date();
  const to = new Date(Date.now() + 7 * 86_400_000);
  const q = useQuery({
    queryKey: ['outlook', 'events'],
    queryFn: () => get<{ connected: boolean; reason?: string; events: { id: string; subject: string; start: string; end: string; joinUrl: string | null; webLink: string | null }[] }>(`/integrations/calendar/events?from=${from.toISOString()}&to=${to.toISOString()}`),
    enabled: !!config?.integrations.outlookCalendar,
    retry: false,
  });
  if (!config?.integrations.outlookCalendar) {
    return <div className="mt-6"><Notice tone="neutral" title="Calendário do Outlook">A integração com o Microsoft 365 não está configurada neste ambiente. Quando configurada, seus próximos compromissos do Outlook aparecerão aqui (somente leitura).</Notice></div>;
  }
  return (
    <Card className="mt-6">
      <CardHeader title="Meu calendário do Outlook (7 dias)" description="Lido sob demanda do Microsoft 365; nada é copiado para a plataforma." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.connected ? (
        <p className="px-5 py-4 text-[13px] text-fg-3">{q.data!.reason}</p>
      ) : q.data!.events.length === 0 ? <EmptyState title="Sem compromissos nos próximos 7 dias" /> : (
        <ul className="divide-y divide-line">
          {q.data!.events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs text-fg-3">{formatDateTime(e.start)}–{formatTime(e.end)}</span>
              <span className="min-w-0 flex-1 truncate">{e.subject}</span>
              {e.joinUrl && <a href={e.joinUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-text hover:underline">Entrar no Teams</a>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CreateMeetingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { config } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [provider, setProvider] = useState<'webrtc' | 'teams'>('webrtc');
  const [participants, setParticipants] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/meetings', {
      title,
      participantIds: participants,
      provider,
      scheduledStartAt: when === 'later' && start ? new Date(start).toISOString() : null,
      scheduledEndAt: when === 'later' && end ? new Date(end).toISOString() : null,
    }),
    onSuccess: (m) => {
      onOpenChange(false);
      navigate(`/reunioes/${m.id}${when === 'now' ? '?entrar=1' : ''}`);
    },
    onError: (e) => toast.error('Não foi possível criar a reunião', e),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nova reunião" footer={<><Button onClick={() => onOpenChange(false)}>Cancelar</Button><Button variant="primary" disabled={title.trim().length < 2 || (when === 'later' && !start)} loading={create.isPending} onClick={() => create.mutate()}>{when === 'now' ? 'Iniciar agora' : 'Agendar'}</Button></>}>
      <div className="space-y-4">
        <Field label="Título" required>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Alinhamento da carteira" autoFocus />}</Field>
        <Field label="Quando">
          {(id) => (
            <Select id={id} value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
              <option value="now">Agora (chamada imediata)</option>
              <option value="later">Agendar</option>
            </Select>
          )}
        </Field>
        {when === 'later' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início" required>{(id) => <Input id={id} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
            <Field label="Término">{(id) => <Input id={id} type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />}</Field>
          </div>
        )}
        <Field label="Plataforma" hint={config?.integrations.teamsMeetings ? undefined : 'Microsoft Teams indisponível: integração não configurada.'}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
              <option value="webrtc">Chamada da plataforma (vídeo no navegador)</option>
              <option value="teams" disabled={!config?.integrations.teamsMeetings}>Microsoft Teams</option>
            </Select>
          )}
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Participantes</p>
          <Button size="sm" onClick={() => setPicker(true)}>{participants.length ? `${participants.length} selecionados — alterar` : 'Escolher participantes'}</Button>
        </div>
      </div>
      <PeoplePicker open={picker} onOpenChange={setPicker} title="Participantes" confirmLabel="Confirmar" onConfirm={setParticipants} />
    </Dialog>
  );
}
