import { PRESENCE_LABELS, type UserSummary } from '@uon/shared/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarOff, Lock, Mail, MessageSquare, Phone, Video } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar, Badge, Button, Card, ErrorState, Notice, Spinner } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { usePresence } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import type { DirectoryPerson } from './People';

const ROLE: Record<string, string> = { member: 'Membro', agent: 'Atendente', head: 'Responsável', coordinator: 'Coordenação' };

export default function PersonPage() {
  const { id } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ['profile', id], queryFn: () => get<DirectoryPerson & { phone: string | null; contactRestricted: boolean }>(`/users/${id}/profile`) });
  const absence = useQuery({ queryKey: ['absence', id], queryFn: () => get<{ absence: null | { status: string; startsAt: string; endsAt: string; message?: string | null; substitute?: UserSummary | null; restricted: boolean } }>(`/users/${id}/absence`) });
  const presence = usePresence(id, q.data?.presence);
  const chat = useMutation({ mutationFn: () => post<{ id: string }>('/conversations/direct', { userId: id }), onSuccess: (c) => navigate(`/conversas/${c.id}`), onError: (e) => toast.error('Não foi possível iniciar a conversa', e) });
  const call = useMutation({ mutationFn: () => post<{ id: string }>('/meetings', { title: `Chamada com ${q.data?.displayName}`, participantIds: [id] }), onSuccess: (m) => navigate(`/reunioes/${m.id}?entrar=1`), onError: (e) => toast.error('Não foi possível iniciar a chamada', e) });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner />;
  const p = q.data;
  const a = absence.data?.absence;
  return (
    <PageContainer>
      <Link to="/pessoas" className="text-[13px] text-fg-3 hover:underline">Pessoas</Link>
      <Card className="mt-2 p-6">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={p.displayName} src={p.avatarUrl} size={80} presence={presence?.status ?? null} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{p.displayName}</h1>
            <p className="text-sm text-fg-2">{p.jobTitle}</p>
            {presence && (
              <p className="mt-1 text-[13px] text-fg-3">
                {PRESENCE_LABELS[presence.status]} · {presence.source === 'manual' ? 'definido pela pessoa' : presence.source === 'absence' ? 'ausência programada' : presence.connected ? 'conectado(a) agora' : `visto(a) ${formatRelative(presence.lastSeenAt)}`}
                {presence.message && ` · “${presence.message}”`}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">{p.isDemo && <Badge tone="info">Conta de demonstração</Badge>}{p.status !== 'active' && <Badge tone="danger">Inativa</Badge>}</div>
          </div>
          {p.id !== me.user.id && p.status === 'active' && (
            <div className="flex gap-2">
              <Button icon={<MessageSquare className="size-4" />} onClick={() => chat.mutate()} loading={chat.isPending}>Mensagem</Button>
              <Button icon={<Video className="size-4" />} onClick={() => call.mutate()} loading={call.isPending}>Chamada</Button>
            </div>
          )}
        </div>
        <dl className="mt-6 grid gap-4 border-t border-line pt-5 text-[13px] sm:grid-cols-2">
          <div><dt className="text-xs text-fg-3">E-mail</dt><dd className="flex items-center gap-1.5"><Mail className="size-3.5 text-fg-3" aria-hidden /><a className="hover:underline" href={`mailto:${p.email}`}>{p.email}</a></dd></div>
          <div><dt className="text-xs text-fg-3">Telefone</dt><dd className="flex items-center gap-1.5">{p.phone ? <><Phone className="size-3.5 text-fg-3" aria-hidden />{p.phone}</> : p.contactRestricted ? <><Lock className="size-3.5 text-fg-3" aria-hidden /> Visível apenas para o mesmo departamento</> : '—'}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-fg-3">Organização</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">{p.org.length === 0 ? '—' : p.org.map((o, i) => <Badge key={i}>{o.teamName ? `${o.teamName} (${o.departmentName})` : o.departmentName} · {ROLE[o.role] ?? o.role}</Badge>)}</dd>
          </div>
        </dl>
      </Card>
      {a && (
        <div className="mt-4">
          <Notice tone="warning" icon={<CalendarOff className="size-4" />} title={a.status === 'active' ? 'Ausente no momento' : 'Ausência programada'}>
            De {formatDateTime(a.startsAt)} até {formatDateTime(a.endsAt)}.
            {a.restricted ? ' Os detalhes desta ausência são visíveis apenas para a equipe ou o departamento da pessoa.' : (
              <>{a.message && <> “{a.message}”</>}{a.substitute && <> Contato substituto: <Link className="font-medium underline" to={`/pessoas/${a.substitute.id}`}>{a.substitute.displayName}</Link>.</>}</>
            )}
          </Notice>
        </div>
      )}
    </PageContainer>
  );
}
