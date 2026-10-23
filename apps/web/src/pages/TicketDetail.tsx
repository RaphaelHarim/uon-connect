import type { UserSummary } from '@uon/shared/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Download, Eye, FileText, Lock, MessageSquareLock, Paperclip, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar, Badge, Button, Card, CardHeader, ColorBadge, Dialog, ErrorState, Field, Notice, Select, Spinner, Switch, Textarea } from '@/components/ui';
import { del, fileUrl, get, post, upload } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { SLA_BADGE } from './Tickets';

interface FileView {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface TicketDetail {
  id: string;
  protocol: string;
  title: string;
  description: string;
  status: { key: string; label: string; color: string };
  priority: { key: string; label: string; color: string };
  category: { id: string; name: string } | null;
  destination: string;
  handlingDepartment: { id: string; name: string } | null;
  handlingTeam: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  requester: UserSummary;
  assignee: UserSummary | null;
  watchers: UserSummary[];
  confidential: boolean;
  sla: { state: string; firstResponseDueAt: string | null; resolutionDueAt: string | null; firstRespondedAt: string | null };
  resolvedAt: string | null;
  closedAt: string | null;
  reopenedCount: number;
  createdAt: string;
  updatedAt: string;
  comments: { id: string; body: string; internal: boolean; createdAt: string; author: UserSummary; attachments: FileView[] }[];
  attachments: FileView[];
  events: { id: number; type: string; from: string | null; to: string | null; data: Record<string, unknown> | null; createdAt: string; actor: UserSummary | null }[];
  permissions: {
    relation: { requester: boolean; handler: boolean; overseer: boolean; watcher: boolean };
    canComment: boolean;
    canAddInternalNote: boolean;
    canAssign: boolean;
    canChangePriority: boolean;
    canManageWatchers: boolean;
    transitions: { to: string; label: string; requiresReason: boolean }[];
  };
}

const EVENT_TEXT: Record<string, string> = {
  created: 'abriu o chamado',
  assigned: 'alterou o responsável',
  status_changed: 'alterou o status',
  reopened: 'reabriu o chamado',
  comment: 'respondeu',
  internal_note: 'registrou uma nota interna',
  priority_changed: 'alterou a prioridade',
  watcher_added: 'compartilhou o chamado',
  watcher_removed: 'removeu um acompanhante',
  sla_warning: 'Alerta: prazo de SLA próximo do vencimento',
};

function Attachment({ f }: { f: FileView }) {
  return (
    <a href={fileUrl(f.id)} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] hover:bg-surface-2" download>
      <FileText className="size-4 shrink-0 text-fg-3" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      <span className="text-xs text-fg-3">{formatBytes(f.sizeBytes)}</span>
      <Download className="size-3.5 text-fg-3" aria-hidden />
    </a>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => get<TicketDetail>(`/tickets/${id}`) });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState<FileView[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [transition, setTransition] = useState<{ to: string; label: string; requiresReason: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ticket', id] });
    void qc.invalidateQueries({ queryKey: ['tickets'] });
  };

  const comment = useMutation({
    mutationFn: () => post(`/tickets/${id}/comments`, { body, internal, attachmentIds: pending.map((p) => p.id) }),
    onSuccess: () => {
      setBody('');
      setPending([]);
      setInternal(false);
      refresh();
      toast.success(internal ? 'Nota interna registrada' : 'Resposta enviada');
    },
    onError: (e) => toast.error('Não foi possível enviar', e),
  });
  const changeStatus = useMutation({
    mutationFn: (v: { status: string; reason?: string }) => post(`/tickets/${id}/status`, v),
    onSuccess: () => {
      setTransition(null);
      setReason('');
      refresh();
      toast.success('Status atualizado');
    },
    onError: (e) => toast.error('Não foi possível alterar o status', e),
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => post(`/tickets/${id}/assign`, { assigneeId }),
    onSuccess: () => {
      refresh();
      toast.success('Responsável atualizado');
    },
    onError: (e) => toast.error('Não foi possível atribuir', e),
  });
  const priority = useMutation({
    mutationFn: (p: string) => post(`/tickets/${id}/priority`, { priority: p }),
    onSuccess: () => {
      refresh();
      toast.success('Prioridade atualizada');
    },
    onError: (e) => toast.error('Não foi possível alterar a prioridade', e),
  });
  const assignable = useQuery({ queryKey: ['ticket', id, 'assignable'], queryFn: () => get<UserSummary[]>(`/tickets/${id}/assignable`), enabled: !!q.data?.permissions.canAssign });
  const priorities = useQuery({ queryKey: ['tickets', 'form-options'], queryFn: () => get<{ priorities: { key: string; label: string }[] }>('/tickets/form-options'), enabled: !!q.data?.permissions.canChangePriority });

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const t = q.data;
  const p = t.permissions;

  const onFiles = async (list: FileList | null) => {
    for (const f of [...(list ?? [])]) {
      try {
        setUploading(0);
        const v = await upload<FileView>(`/tickets/${id}/attachments`, f, setUploading);
        setPending((l) => [...l, v]);
      } catch (e) {
        toast.error(`Falha ao enviar ${f.name}`, e);
      } finally {
        setUploading(null);
      }
    }
  };

  const timeline = [
    ...t.comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt, c })),
    ...t.events.filter((e) => !['comment', 'internal_note'].includes(e.type)).map((e) => ({ kind: 'event' as const, at: e.createdAt, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <PageContainer wide>
      <div className="mb-5">
        <Link to="/chamados" className="text-[13px] text-fg-3 hover:underline">
          Chamados
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] text-fg-3">{t.protocol}</span>
          <ColorBadge color={t.status.color} label={t.status.label} />
          <ColorBadge color={t.priority.color} label={t.priority.label} />
          {t.confidential && <Badge icon={<Lock className="size-3" />}>Confidencial</Badge>}
          {t.reopenedCount > 0 && <Badge tone="warning">Reaberto {t.reopenedCount}×</Badge>}
        </div>
        <h1 className="mt-2 text-[22px] leading-tight font-semibold tracking-tight">{t.title}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <Avatar name={t.requester.displayName} src={t.requester.avatarUrl} size={30} />
              <div className="text-[13px]">
                <p className="font-medium">{t.requester.displayName}</p>
                <p className="text-fg-3">abriu em {formatDateTime(t.createdAt)}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{t.description}</p>
            {t.attachments.length > 0 && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {t.attachments.map((f) => (
                  <Attachment key={f.id} f={f} />
                ))}
              </div>
            )}
          </Card>

          <section aria-label="Histórico" className="space-y-3">
            {timeline.map((item) =>
              item.kind === 'comment' ? (
                <Card key={item.c.id} className={cn('p-4', item.c.internal && 'border-warning/40 bg-warning-soft/40')}>
                  <div className="mb-2 flex items-center gap-2.5">
                    <Avatar name={item.c.author.displayName} src={item.c.author.avatarUrl} size={26} />
                    <p className="text-[13px]">
                      <span className="font-medium">{item.c.author.displayName}</span> <span className="text-fg-3">· {formatRelative(item.c.createdAt)}</span>
                    </p>
                    {item.c.internal && <Badge tone="warning" icon={<MessageSquareLock className="size-3" />} className="ml-auto">Nota interna</Badge>}
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.c.body}</p>
                  {item.c.attachments.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{item.c.attachments.map((f) => <Attachment key={f.id} f={f} />)}</div>}
                </Card>
              ) : (
                <div key={`e${item.e.id}`} className="flex items-center gap-2 px-2 text-[13px] text-fg-3">
                  <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium text-fg-2">{item.e.actor?.displayName ?? 'Sistema'}</span> {EVENT_TEXT[item.e.type] ?? item.e.type}
                    {item.e.type === 'status_changed' || item.e.type === 'reopened' ? ` para “${statusLabel(item.e.to)}”` : ''}
                    {item.e.data?.automatic ? ' (automático)' : ''}
                  </span>
                  <span className="ml-auto shrink-0">{formatRelative(item.e.createdAt)}</span>
                </div>
              ),
            )}
          </section>

          {p.canComment ? (
            <Card className="p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (body.trim()) comment.mutate();
                }}
                className="space-y-3"
              >
                <Field label={internal ? 'Nota interna (visível só para quem atende)' : 'Responder'}>
                  {(fid) => <Textarea id={fid} value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={internal ? 'Registre informações para a equipe de atendimento…' : 'Escreva sua resposta…'} />}
                </Field>
                {pending.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {pending.map((f) => (
                      <li key={f.id} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs">
                        <Paperclip className="size-3" aria-hidden /> {f.name}
                        <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setPending((l) => l.filter((x) => x.id !== f.id))}>
                          <X className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-fg-2 hover:bg-surface-2">
                    <Paperclip className="size-4" aria-hidden />
                    {uploading !== null ? `Enviando ${Math.round(uploading * 100)}%` : 'Anexar'}
                    <input type="file" multiple className="sr-only" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
                  </label>
                  {p.canAddInternalNote && (
                    <label className="flex items-center gap-2 text-[13px] text-fg-2">
                      <Switch label="Nota interna" checked={internal} onCheckedChange={setInternal} /> Nota interna
                    </label>
                  )}
                  <Button type="submit" variant="primary" className="ml-auto" loading={comment.isPending} disabled={!body.trim() || uploading !== null}>
                    Enviar
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Notice tone="neutral">Este chamado está {t.status.label.toLowerCase()}. {p.transitions.length > 0 ? 'Reabra-o para continuar a conversa.' : ''}</Notice>
          )}
        </div>

        <aside className="space-y-4">
          {p.transitions.length > 0 && (
            <Card className="p-4">
              <p className="mb-2.5 text-[13px] font-semibold">Ações</p>
              <div className="flex flex-col gap-2">
                {p.transitions.map((tr) => (
                  <Button
                    key={tr.to}
                    variant={tr.to === 'resolved' || tr.to === 'closed' ? 'primary' : tr.to === 'cancelled' ? 'ghost' : 'secondary'}
                    className="justify-center"
                    onClick={() => (tr.requiresReason ? setTransition(tr) : changeStatus.mutate({ status: tr.to }))}
                    loading={changeStatus.isPending && changeStatus.variables?.status === tr.to}
                  >
                    {transitionLabel(tr.to, t.status.key)}
                  </Button>
                ))}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Detalhes" />
            <dl className="space-y-3 px-5 py-4 text-[13px]">
              <Row label="Categoria">{t.category?.name}</Row>
              <Row label="Fila">{t.handlingTeam ? `${t.handlingTeam.name} (${t.handlingDepartment?.name})` : t.handlingDepartment?.name}</Row>
              {t.client && <Row label="Carteira">{t.client.name}</Row>}
              <Row label="Responsável">
                {p.canAssign ? (
                  <Select aria-label="Responsável" value={t.assignee?.id ?? ''} onChange={(e) => assign.mutate(e.target.value || null)} disabled={assign.isPending}>
                    <option value="">Sem responsável</option>
                    {assignable.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </Select>
                ) : (
                  t.assignee?.displayName ?? 'Sem responsável'
                )}
              </Row>
              <Row label="Prioridade">
                {p.canChangePriority && priorities.data ? (
                  <Select aria-label="Prioridade" value={t.priority.key} onChange={(e) => priority.mutate(e.target.value)} disabled={priority.isPending}>
                    {priorities.data.priorities.map((pr) => (
                      <option key={pr.key} value={pr.key}>
                        {pr.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  t.priority.label
                )}
              </Row>
              <Row label="SLA">
                <Badge tone={SLA_BADGE[t.sla.state]?.tone}>{SLA_BADGE[t.sla.state]?.label}</Badge>
                {t.sla.resolutionDueAt && <p className="mt-1 text-xs text-fg-3">Solução até {formatDateTime(t.sla.resolutionDueAt)}</p>}
                {t.sla.firstResponseDueAt && <p className="text-xs text-fg-3">1ª resposta até {formatDateTime(t.sla.firstResponseDueAt)}{t.sla.firstRespondedAt ? ` (respondido ${formatDateTime(t.sla.firstRespondedAt)})` : ''}</p>}
              </Row>
              <Row label="Atualizado">{formatDateTime(t.updatedAt)}</Row>
              {t.resolvedAt && <Row label="Resolvido">{formatDateTime(t.resolvedAt)}</Row>}
              {t.closedAt && <Row label="Encerrado">{formatDateTime(t.closedAt)}</Row>}
            </dl>
          </Card>
          <Card>
            <CardHeader
              title="Acompanhantes"
              description="Pessoas com acesso de leitura."
              actions={p.canManageWatchers && <Button size="sm" variant="ghost" icon={<UserPlus className="size-4" />} onClick={() => setShareOpen(true)}>Compartilhar</Button>}
            />
            <ul className="space-y-2 px-5 py-4">
              {t.watchers.length === 0 && <li className="text-[13px] text-fg-3">Ninguém além dos envolvidos.</li>}
              {t.watchers.map((w) => (
                <li key={w.id} className="flex items-center gap-2 text-[13px]">
                  <Avatar name={w.displayName} src={w.avatarUrl} size={24} />
                  <span className="flex-1 truncate">{w.displayName}</span>
                  {p.canManageWatchers && (
                    <button aria-label={`Remover ${w.displayName}`} onClick={() => void del(`/tickets/${id}/watchers/${w.id}`).then(refresh)}>
                      <X className="size-4 text-fg-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-xs text-fg-3">
              <Eye className="size-3.5" aria-hidden />
              Seu acesso: {[p.relation.requester && 'solicitante', p.relation.handler && 'atendimento', p.relation.overseer && 'supervisão', p.relation.watcher && 'acompanhante'].filter(Boolean).join(', ')}
            </p>
          </Card>
        </aside>
      </div>

      <Dialog
        open={!!transition}
        onOpenChange={(v) => !v && setTransition(null)}
        title={transition ? transitionLabel(transition.to, t.status.key) : ''}
        description="Esta ação exige um motivo, que ficará registrado no histórico do chamado."
        footer={
          <>
            <Button onClick={() => setTransition(null)}>Cancelar</Button>
            <Button variant={transition?.to === 'cancelled' ? 'danger' : 'primary'} disabled={!reason.trim()} loading={changeStatus.isPending} onClick={() => transition && changeStatus.mutate({ status: transition.to, reason })}>
              Confirmar
            </Button>
          </>
        }
      >
        <Field label="Motivo" required>
          {(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />}
        </Field>
      </Dialog>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} ticketId={t.id} onDone={refresh} />
    </PageContainer>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-0.5 text-xs text-fg-3">{label}</dt>
      <dd className="text-fg">{children ?? '—'}</dd>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  triage: 'Em triagem',
  in_progress: 'Em andamento',
  waiting_requester: 'Aguardando solicitante',
  waiting_third_party: 'Aguardando terceiro',
  resolved: 'Resolvido',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};
const statusLabel = (k: string | null) => (k ? STATUS_LABELS[k] ?? k : '');

function transitionLabel(to: string, from: string) {
  if ((from === 'resolved' || from === 'closed') && to === 'in_progress') return 'Reabrir chamado';
  return (
    {
      triage: 'Iniciar triagem',
      in_progress: from === 'open' || from === 'triage' ? 'Iniciar atendimento' : 'Retomar atendimento',
      waiting_requester: 'Aguardar solicitante',
      waiting_third_party: 'Aguardar terceiro',
      resolved: 'Marcar como resolvido',
      closed: from === 'resolved' ? 'Confirmar e encerrar' : 'Encerrar',
      cancelled: 'Cancelar chamado',
    }[to] ?? statusLabel(to)
  );
}

function ShareDialog({ open, onOpenChange, ticketId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; ticketId: string; onDone: () => void }) {
  const [q, setQ] = useState('');
  const toast = useToast();
  const people = useQuery({ queryKey: ['directory', q], queryFn: () => get<{ items: UserSummary[] }>(`/directory?pageSize=8&q=${encodeURIComponent(q)}`), enabled: open });
  const add = useMutation({
    mutationFn: (userId: string) => post(`/tickets/${ticketId}/watchers`, { userId }),
    onSuccess: () => {
      onDone();
      onOpenChange(false);
      toast.success('Chamado compartilhado');
    },
    onError: (e) => toast.error('Não foi possível compartilhar', e),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Compartilhar chamado" description="A pessoa poderá ler o chamado e será notificada das atualizações.">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar colaborador" aria-label="Buscar colaborador" className="mb-3 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm" />
      <ul className="space-y-1">
        {people.data?.items.map((u) => (
          <li key={u.id}>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => add.mutate(u.id)}>
              <Avatar name={u.displayName} src={u.avatarUrl} size={28} />
              <span className="min-w-0">
                <span className="block truncate text-sm">{u.displayName}</span>
                <span className="block truncate text-xs text-fg-3">{u.jobTitle ?? u.email}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
