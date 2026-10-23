import { ALLOWED_REACTIONS, type PresenceView, PRESENCE_LABELS, type UserSummary } from '@uon/shared/browser';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  AtSign,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Reply,
  Search,
  Send,
  Settings2,
  SmilePlus,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar, Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Select, Spinner, Switch, Tabs, Textarea } from '@/components/ui';
import { ApiError, del, fileUrl, get, patch, post, put, upload } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate, formatRelative, formatTime } from '@/lib/format';
import { usePresence } from '@/lib/realtime';
import { getSocket } from '@/lib/socket';
import { useToast } from '@/lib/toast';

/* ------------------------------------------------------------------ types */

interface ConversationItem {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  other: (UserSummary & { presence: PresenceView | null }) | null;
  unread: number;
  lastMessage: { body: string; kind: string; senderName: string | null; createdAt: string } | null;
  lastActivityAt: string;
}

interface Member extends UserSummary {
  role: 'member' | 'admin';
  lastReadAt: string | null;
  presence: PresenceView | null;
}

interface ConversationDetail {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  description: string | null;
  teamId: string | null;
  allowMembersInvite: boolean;
  me: { role: 'member' | 'admin'; notifications: 'all' | 'mentions' | 'none' };
  members: Member[];
}

interface FileView {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

interface Message {
  id: string;
  conversationId: string;
  kind: 'user' | 'system';
  sender: UserSummary | null;
  body: string;
  deleted: boolean;
  important: boolean;
  clientNonce: string | null;
  createdAt: string;
  editedAt: string | null;
  replyTo: { id: string; body: string; senderName: string | null } | null;
  attachments: FileView[];
  reactions: { emoji: string; count: number; userIds: string[] }[];
  mentions: string[];
  /** Local-only delivery state for optimistic messages. */
  local?: 'sending' | 'failed';
  localError?: string;
}

/* ------------------------------------------------------------------ page */

export default function ChatPage() {
  const { id } = useParams();
  const [newOpen, setNewOpen] = useState(false);
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn('flex w-full shrink-0 flex-col border-r border-line bg-surface md:w-80', id && 'hidden md:flex')}>
        <ConversationList activeId={id} onNew={() => setNewOpen(true)} />
      </aside>
      <section className={cn('min-w-0 flex-1', !id && 'hidden md:block')}>
        {id ? (
          <ConversationView key={id} id={id} />
        ) : (
          <EmptyState icon={<MessageSquarePlus className="size-5" />} title="Selecione uma conversa" description="Ou inicie uma nova conversa individual ou em grupo." action={<Button variant="primary" onClick={() => setNewOpen(true)}>Nova conversa</Button>} />
        )}
      </section>
      <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function ConversationList({ activeId, onNew }: { activeId?: string; onNew: () => void }) {
  const q = useQuery({ queryKey: ['conversations'], queryFn: () => get<ConversationItem[]>('/conversations') });
  const [filter, setFilter] = useState('');
  const items = (q.data ?? []).filter((c) => (c.name ?? '').toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h1 className="text-lg font-semibold">Conversas</h1>
        <Button size="sm" variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={onNew}>
          Nova
        </Button>
      </div>
      <div className="relative px-4 pb-3">
        <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-[70%] text-fg-3" aria-hidden />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar conversas" aria-label="Filtrar conversas" className="pl-9" />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-20 md:pb-2">
        {q.isLoading && <Spinner />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && items.length === 0 && <EmptyState title="Nenhuma conversa" description="Inicie uma conversa com um colega ou crie um grupo." />}
        <ul>
          {items.map((c) => (
            <li key={c.id}>
              <ConversationRow c={c} active={c.id === activeId} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ConversationRow({ c, active }: { c: ConversationItem; active: boolean }) {
  const presence = usePresence(c.other?.id, c.other?.presence);
  return (
    <Link to={`/conversas/${c.id}`} className={cn('flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2', active && 'bg-surface-2')} aria-current={active ? 'page' : undefined}>
      {c.type === 'direct' && c.other ? (
        <Avatar name={c.other.displayName} src={c.other.avatarUrl} size={38} presence={presence?.status ?? null} />
      ) : (
        <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-2">
          <Users className="size-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{c.name}</span>
          <span className="shrink-0 text-[11px] text-fg-3">{c.lastMessage ? formatRelative(c.lastMessage.createdAt) : ''}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className={cn('truncate text-[13px]', c.unread ? 'text-fg' : 'text-fg-3')}>
            {c.lastMessage ? (c.lastMessage.kind === 'system' ? c.lastMessage.body : `${c.type === 'group' && c.lastMessage.senderName ? `${c.lastMessage.senderName}: ` : c.lastMessage.senderName === 'Você' ? 'Você: ' : ''}${c.lastMessage.body || 'Anexo'}`) : 'Sem mensagens'}
          </span>
          {c.unread > 0 && <span className="ml-auto shrink-0 rounded-full bg-brand px-1.5 text-[11px] leading-[18px] font-semibold text-on-brand" aria-label={`${c.unread} não lidas`}>{c.unread}</span>}
        </span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ conversation */

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Plain text with safe links and highlighted mentions. Never renders HTML from the server. */
function MessageText({ text, mentionNames }: { text: string; mentionNames: string[] }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-info underline">
              {part}
            </a>
          );
        }
        if (!mentionNames.length) return <Fragment key={i}>{part}</Fragment>;
        const re = new RegExp(`(@(?:${mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
        return part.split(re).map((seg, j) =>
          j % 2 === 1 ? (
            <span key={`${i}-${j}`} className="rounded bg-brand-soft px-0.5 font-medium text-brand-text">
              {seg}
            </span>
          ) : (
            <Fragment key={`${i}-${j}`}>{seg}</Fragment>
          ),
        );
      })}
    </>
  );
}

function ConversationView({ id }: { id: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const detail = useQuery({ queryKey: ['conversation', id], queryFn: () => get<ConversationDetail>(`/conversations/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const messages = useInfiniteQuery({
    queryKey: ['messages', id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => get<{ items: Message[]; hasMore: boolean }>(`/conversations/${id}/messages?limit=40${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.hasMore && last.items[0] ? last.items[0].createdAt : undefined),
  });
  const [pendingLocal, setPendingLocal] = useState<Message[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [typing, setTyping] = useState<Map<string, { name: string; until: number }>>(new Map());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const serverMessages = useMemo(() => [...(messages.data?.pages ?? [])].reverse().flatMap((p) => p.items), [messages.data]);
  const nonces = new Set(serverMessages.map((m) => m.clientNonce));
  const all = [...serverMessages, ...pendingLocal.filter((m) => !nonces.has(m.clientNonce))];

  // Mark as read while the conversation is open.
  const lastId = serverMessages.at(-1)?.id;
  useEffect(() => {
    if (!lastId) return;
    void post(`/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ['conversations'] })).catch(() => undefined);
  }, [id, lastId, qc]);

  useEffect(() => {
    const s = getSocket();
    const onTyping = (p: { conversationId: string; userId: string; name: string }) => {
      if (p.conversationId !== id) return;
      setTyping((m) => new Map(m).set(p.userId, { name: p.name, until: Date.now() + 4000 }));
    };
    const onNew = (m: Message) => {
      if (m.conversationId === id && m.sender) setTyping((map) => { const n = new Map(map); n.delete(m.sender!.id); return n; });
    };
    s.on('typing', onTyping);
    s.on('message:new', onNew);
    const t = setInterval(() => setTyping((m) => new Map([...m].filter(([, v]) => v.until > Date.now()))), 1500);
    return () => {
      s.off('typing', onTyping);
      s.off('message:new', onNew);
      clearInterval(t);
    };
  }, [id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  const send = async (input: { body: string; files: FileView[]; mentions: string[]; nonce?: string }) => {
    const nonce = input.nonce ?? crypto.randomUUID();
    const optimistic: Message = {
      id: `local-${nonce}`, conversationId: id, kind: 'user', sender: me.user, body: input.body, deleted: false, important: false, clientNonce: nonce, createdAt: new Date().toISOString(), editedAt: null,
      replyTo: replyTo ? { id: replyTo.id, body: replyTo.body, senderName: replyTo.sender?.displayName ?? null } : null, attachments: input.files, reactions: [], mentions: input.mentions, local: 'sending',
    };
    stickToBottom.current = true;
    setPendingLocal((l) => [...l.filter((m) => m.clientNonce !== nonce), optimistic]);
    const reply = replyTo;
    setReplyTo(null);
    try {
      await post(`/conversations/${id}/messages`, { body: input.body, clientNonce: nonce, replyToId: reply?.id ?? null, attachmentIds: input.files.map((f) => f.id), mentions: input.mentions });
      await qc.invalidateQueries({ queryKey: ['messages', id] });
      setPendingLocal((l) => l.filter((m) => m.clientNonce !== nonce));
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      // Never pretend it was delivered: keep it visibly failed with a retry option (same nonce → no duplicate).
      setPendingLocal((l) => l.map((m) => (m.clientNonce === nonce ? { ...m, local: 'failed', localError: (e as Error).message } : m)));
    }
  };

  const startCall = useMutation({
    mutationFn: () => post<{ id: string }>('/meetings', { title: detail.data?.type === 'group' ? `Chamada — ${detail.data.name}` : `Chamada com ${detail.data?.name}`, conversationId: id, participantIds: detail.data!.members.map((m) => m.id).filter((m) => m !== me.user.id) }),
    onSuccess: (m) => navigate(`/reunioes/${m.id}?entrar=1`),
    onError: (e) => toast.error('Não foi possível iniciar a chamada', e),
  });

  if (detail.error) return <ErrorState error={detail.error} />;
  if (!detail.data) return <Spinner />;
  const d = detail.data;
  const other = d.type === 'direct' ? d.members.find((m) => m.id !== me.user.id) : undefined;
  const memberNames = d.members.map((m) => m.displayName);
  const typingNames = [...typing.values()].map((t) => t.name);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Voltar às conversas" onClick={() => navigate('/conversas')}>
          <ArrowLeft className="size-5" />
        </Button>
        {other ? <HeaderPerson member={other} /> : (
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{d.name}</p>
            <p className="truncate text-xs text-fg-3">{d.members.length} participantes{d.teamId ? ' · grupo da equipe' : ''}</p>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Iniciar chamada de vídeo" onClick={() => startCall.mutate()} loading={startCall.isPending}>
            {!startCall.isPending && <Video className="size-[18px]" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Detalhes da conversa" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-[18px]" />
          </Button>
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
        aria-live="polite"
        aria-label="Mensagens"
      >
        {messages.hasNextPage && (
          <div className="mb-4 text-center">
            <Button size="sm" onClick={() => { stickToBottom.current = false; void messages.fetchNextPage(); }} loading={messages.isFetchingNextPage}>
              Carregar mensagens anteriores
            </Button>
          </div>
        )}
        {messages.isLoading && <Spinner />}
        {messages.data && all.length === 0 && <EmptyState title="Nenhuma mensagem ainda" description="Envie a primeira mensagem." />}
        {all.map((m, i) => {
          const prev = all[i - 1];
          const newDay = !prev || formatDate(prev.createdAt) !== formatDate(m.createdAt);
          const grouped = !newDay && prev && prev.kind === 'user' && m.kind === 'user' && prev.sender?.id === m.sender?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-4 flex items-center gap-3 text-[11px] font-medium text-fg-3">
                  <span className="h-px flex-1 bg-line" />
                  {formatDate(m.createdAt)}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              {m.kind === 'system' ? (
                <p className="my-2 text-center text-xs text-fg-3">{m.body}</p>
              ) : (
                <MessageBubble
                  m={m}
                  mine={m.sender?.id === me.user.id}
                  grouped={!!grouped}
                  memberNames={memberNames}
                  conv={d}
                  onReply={() => setReplyTo(m)}
                  onEdit={() => setEditing(m)}
                  onRetry={() => void send({ body: m.body, files: m.attachments, mentions: m.mentions, nonce: m.clientNonce! })}
                  onDiscard={() => setPendingLocal((l) => l.filter((x) => x.clientNonce !== m.clientNonce))}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      <div className="h-5 px-6 text-xs text-fg-3" aria-live="polite">
        {typingNames.length > 0 && `${typingNames.join(', ')} ${typingNames.length > 1 ? 'estão' : 'está'} digitando…`}
      </div>
      <Composer conversationId={id} members={d.members.filter((m) => m.id !== me.user.id)} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSend={send} />
      <EditDialog message={editing} onClose={() => setEditing(null)} />
      <ConversationSettings open={settingsOpen} onOpenChange={setSettingsOpen} detail={d} />
    </div>
  );
}

function HeaderPerson({ member }: { member: Member }) {
  const presence = usePresence(member.id, member.presence);
  return (
    <Link to={`/pessoas/${member.id}`} className="flex min-w-0 items-center gap-2.5">
      <Avatar name={member.displayName} src={member.avatarUrl} size={32} presence={presence?.status ?? null} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{member.displayName}</span>
        <span className="block truncate text-xs text-fg-3">
          {presence ? `${PRESENCE_LABELS[presence.status]}${presence.message ? ` · ${presence.message}` : ''}` : member.jobTitle}
        </span>
      </span>
    </Link>
  );
}

function MessageBubble({ m, mine, grouped, memberNames, conv, onReply, onEdit, onRetry, onDiscard }: { m: Message; mine: boolean; grouped: boolean; memberNames: string[]; conv: ConversationDetail; onReply: () => void; onEdit: () => void; onRetry: () => void; onDiscard: () => void }) {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const react = (emoji: string) => void post(`/messages/${m.id}/reactions`, { emoji }).then(() => qc.invalidateQueries({ queryKey: ['messages', m.conversationId] })).catch((e) => toast.error('Não foi possível reagir', e));
  const remove = () => void del(`/messages/${m.id}`).then(() => qc.invalidateQueries({ queryKey: ['messages', m.conversationId] })).catch((e) => toast.error('Não foi possível apagar', e));

  // Read receipts: "Lida" in direct conversations, "lida por N" in groups.
  const others = conv.members.filter((x) => x.id !== me.user.id);
  const readBy = others.filter((x) => x.lastReadAt && x.lastReadAt >= m.createdAt).length;

  return (
    <div className={cn('group flex gap-2.5', grouped ? 'mt-0.5' : 'mt-3', mine && 'flex-row-reverse')}>
      <div className="w-8 shrink-0">{!grouped && !mine && m.sender && <Avatar name={m.sender.displayName} src={m.sender.avatarUrl} size={32} />}</div>
      <div className={cn('flex max-w-[78%] min-w-0 flex-col', mine && 'items-end')}>
        {!grouped && !mine && <p className="mb-0.5 text-xs font-medium text-fg-2">{m.sender?.displayName}</p>}
        <div className="flex items-center gap-1">
          {!m.deleted && !m.local && (
            <div className={cn('flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100', mine ? 'order-first' : 'order-last')}>
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button className="rounded p-1 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Reagir">
                    <SmilePlus className="size-4" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content sideOffset={4} className="z-50 flex gap-1 rounded-full border border-line bg-surface p-1 shadow-pop">
                    {ALLOWED_REACTIONS.map((e) => (
                      <Popover.Close asChild key={e}>
                        <button className="rounded-full px-1.5 py-0.5 text-lg hover:bg-surface-2" onClick={() => react(e)} aria-label={`Reagir com ${e}`}>
                          {e}
                        </button>
                      </Popover.Close>
                    ))}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <button className="rounded p-1 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Responder" onClick={onReply}>
                <Reply className="size-4" />
              </button>
              {mine && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="rounded p-1 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Mais ações">
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="z-50 rounded-lg border border-line bg-surface p-1 shadow-pop" sideOffset={4}>
                      <DropdownMenu.Item onSelect={onEdit} className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2">
                        <Pencil className="size-4" /> Editar
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={remove} className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-surface-2">
                        <Trash2 className="size-4" /> Apagar
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
            </div>
          )}
          <div className={cn('min-w-0 rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-card', mine ? 'rounded-tr-md bg-brand text-on-brand' : 'rounded-tl-md border border-line bg-surface', m.deleted && 'bg-surface-2 text-fg-3 italic shadow-none', m.local === 'failed' && 'opacity-80 ring-2 ring-danger')}>
            {m.replyTo && (
              <div className={cn('mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs', mine ? 'border-white/60 bg-white/15' : 'border-brand bg-surface-2')}>
                <p className="font-medium">{m.replyTo.senderName}</p>
                <p className="line-clamp-2 opacity-90">{m.replyTo.body}</p>
              </div>
            )}
            {m.deleted ? 'Mensagem apagada' : m.body && <p className="break-words whitespace-pre-wrap"><MessageText text={m.body} mentionNames={memberNames} /></p>}
            {m.attachments.length > 0 && (
              <div className="mt-1.5 space-y-1.5">
                {m.attachments.map((f) =>
                  f.mimeType.startsWith('image/') && !m.local ? (
                    <a key={f.id} href={fileUrl(f.id, true)} target="_blank" rel="noreferrer">
                      <img src={fileUrl(f.id, true)} alt={f.name} className="max-h-60 max-w-full rounded-lg object-cover" loading="lazy" />
                    </a>
                  ) : (
                    <a key={f.id} href={fileUrl(f.id)} download className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs', mine ? 'bg-white/15' : 'bg-surface-2')}>
                      <FileText className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{f.name}</span>
                      <span className="opacity-75">{formatBytes(f.sizeBytes)}</span>
                    </a>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button key={r.emoji} onClick={() => react(r.emoji)} className={cn('flex items-center gap-1 rounded-full border px-1.5 text-xs', r.userIds.includes(me.user.id) ? 'border-brand/40 bg-brand-soft' : 'border-line bg-surface')} aria-label={`${r.emoji} ${r.count}`} aria-pressed={r.userIds.includes(me.user.id)}>
                {r.emoji} <span className="tabular-nums">{r.count}</span>
              </button>
            ))}
          </div>
        )}
        <p className={cn('mt-0.5 flex items-center gap-1 text-[11px] text-fg-3', mine && 'justify-end')}>
          {formatTime(m.createdAt)}
          {m.editedAt && ' · editada'}
          {mine && m.local === 'sending' && (<><Clock className="size-3" aria-hidden /> Enviando…</>)}
          {mine && m.local === 'failed' && (
            <span className="flex items-center gap-1.5 text-danger" role="alert">
              <AlertCircle className="size-3" aria-hidden /> Não enviada
              <button className="font-semibold underline" onClick={onRetry}>Tentar de novo</button>
              <button className="underline" onClick={onDiscard}>Descartar</button>
            </span>
          )}
          {mine && !m.local && !m.deleted && (
            conv.type === 'direct'
              ? readBy > 0 ? <><CheckCheck className="size-3.5 text-info" aria-hidden /> Lida</> : <><Check className="size-3.5" aria-hidden /> Enviada</>
              : <><Check className="size-3.5" aria-hidden /> {readBy > 0 ? `Lida por ${readBy}` : 'Enviada'}</>
          )}
        </p>
      </div>
    </div>
  );
}

function Composer({ conversationId, members, replyTo, onCancelReply, onSend }: { conversationId: string; members: Member[]; replyTo: Message | null; onCancelReply: () => void; onSend: (i: { body: string; files: FileView[]; mentions: string[] }) => Promise<void> }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileView[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const toast = useToast();
  const lastTyping = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  const submit = () => {
    const body = text.trim();
    if (!body && !files.length) return;
    // Keep only mentions still present in the text.
    const kept = mentions.filter((id) => body.includes(`@${members.find((m) => m.id === id)?.displayName}`));
    void onSend({ body, files, mentions: kept });
    setText('');
    setFiles([]);
    setMentions([]);
  };

  const onFile = async (list: FileList | null) => {
    for (const f of [...(list ?? [])]) {
      try {
        setProgress(0);
        const v = await upload<FileView>(`/conversations/${conversationId}/files`, f, setProgress);
        setFiles((l) => [...l, v]);
      } catch (e) {
        toast.error(`Arquivo recusado: ${f.name}`, e);
      } finally {
        setProgress(null);
      }
    }
  };

  return (
    <div className="border-t border-line bg-surface px-3 pt-2 pb-3 sm:px-4">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
          <Reply className="mt-0.5 size-3.5 text-fg-3" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Respondendo a {replyTo.sender?.displayName}</p>
            <p className="truncate text-fg-3">{replyTo.body}</p>
          </div>
          <button aria-label="Cancelar resposta" onClick={onCancelReply}>
            <X className="size-4 text-fg-3" />
          </button>
        </div>
      )}
      {(files.length > 0 || progress !== null) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.id} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs">
              <Paperclip className="size-3" aria-hidden />
              {f.name}
              <button aria-label={`Remover ${f.name}`} onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          {progress !== null && (
            <span className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Enviando arquivo {Math.round(progress * 100)}%
            </span>
          )}
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <label className="cursor-pointer rounded-lg p-2 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Anexar arquivo">
          <Paperclip className="size-[18px]" aria-hidden />
          <input type="file" multiple className="sr-only" onChange={(e) => { void onFile(e.target.files); e.target.value = ''; }} />
        </label>
        {members.length > 0 && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button className="rounded-lg p-2 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Mencionar alguém">
                <AtSign className="size-[18px]" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="top" align="start" sideOffset={6} className="scrollbar-thin z-50 max-h-64 w-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
                {members.map((m) => (
                  <Popover.Close asChild key={m.id}>
                    <button
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.displayName} `);
                        setMentions((l) => [...new Set([...l, m.id])]);
                        ref.current?.focus();
                      }}
                    >
                      <Avatar name={m.displayName} src={m.avatarUrl} size={22} /> {m.displayName}
                    </button>
                  </Popover.Close>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          aria-label="Mensagem"
          placeholder="Escreva uma mensagem…"
          onChange={(e) => {
            setText(e.target.value);
            if (Date.now() - lastTyping.current > 2500) {
              lastTyping.current = Date.now();
              getSocket().emit('typing', { conversationId });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none [field-sizing:content] placeholder:text-fg-3"
        />
        <Button variant="primary" size="icon" aria-label="Enviar mensagem" onClick={submit} disabled={(!text.trim() && !files.length) || progress !== null}>
          <Send className="size-4" />
        </Button>
      </div>
      <p className="mt-1 hidden text-[11px] text-fg-3 sm:block">Enter envia · Shift+Enter quebra linha</p>
    </div>
  );
}

function EditDialog({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => setText(message?.body ?? ''), [message]);
  const save = useMutation({
    mutationFn: () => patch(`/messages/${message!.id}`, { body: text }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['messages', message!.conversationId] });
      onClose();
    },
    onError: (e) => toast.error('Não foi possível editar', e),
  });
  return (
    <Dialog open={!!message} onOpenChange={(v) => !v && onClose()} title="Editar mensagem" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!text.trim()} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto da mensagem" autoFocus />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ settings */

function ConversationSettings({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (v: boolean) => void; detail: ConversationDetail }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('membros');
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const files = useQuery({ queryKey: ['conversation', detail.id, 'files'], queryFn: () => get<(FileView & { senderName: string; sentAt: string })[]>(`/conversations/${detail.id}/files`), enabled: open && tab === 'arquivos' });
  const isAdmin = detail.me.role === 'admin';
  const refresh = () => qc.invalidateQueries({ queryKey: ['conversation', detail.id] });
  const act = (p: Promise<unknown>, ok: string) => void p.then(() => { void refresh(); toast.success(ok); }).catch((e) => toast.error('Não foi possível concluir', e));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={detail.name ?? 'Conversa'} description={detail.description ?? (detail.type === 'direct' ? 'Conversa individual' : 'Grupo')} size="lg">
      <Tabs value={tab} onValueChange={setTab} items={[{ value: 'membros', label: 'Participantes', count: detail.members.length }, { value: 'arquivos', label: 'Arquivos' }, { value: 'ajustes', label: 'Notificações' }]} />
      {tab === 'membros' && (
        <div>
          {detail.type === 'group' && (isAdmin || detail.allowMembersInvite) && (
            <Button size="sm" className="mb-3" icon={<Users className="size-4" />} onClick={() => setAdding(true)}>Adicionar participantes</Button>
          )}
          <ul className="divide-y divide-line">
            {detail.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <Avatar name={m.displayName} src={m.avatarUrl} size={30} presence={m.presence?.status ?? null} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.displayName}{m.id === me.user.id && ' (você)'}</p>
                  <p className="truncate text-xs text-fg-3">{m.jobTitle}</p>
                </div>
                {m.role === 'admin' && <Badge tone="brand">Admin do grupo</Badge>}
                {detail.type === 'group' && isAdmin && m.id !== me.user.id && (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild><Button size="icon" variant="ghost" aria-label={`Ações para ${m.displayName}`}><MoreHorizontal className="size-4" /></Button></DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="z-[60] rounded-lg border border-line bg-surface p-1 shadow-pop" sideOffset={4}>
                        <DropdownMenu.Item className="cursor-pointer rounded px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2" onSelect={() => act(put(`/conversations/${detail.id}/members/${m.id}/role`, { role: m.role === 'admin' ? 'member' : 'admin' }), 'Função atualizada')}>
                          {m.role === 'admin' ? 'Remover administração' : 'Tornar administrador'}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item className="cursor-pointer rounded px-2.5 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-surface-2" onSelect={() => act(del(`/conversations/${detail.id}/members/${m.id}`), 'Participante removido')}>
                          Remover do grupo
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                )}
              </li>
            ))}
          </ul>
          {detail.type === 'group' && (
            <Button variant="ghost" className="mt-3 text-danger" onClick={() => setLeaving(true)}>Sair do grupo</Button>
          )}
        </div>
      )}
      {tab === 'arquivos' && (
        files.isLoading ? <Spinner /> : !files.data?.length ? <EmptyState title="Nenhum arquivo compartilhado" /> : (
          <ul className="divide-y divide-line">
            {files.data.map((f) => (
              <li key={f.id}>
                <a href={fileUrl(f.id)} download className="flex items-center gap-3 py-2 hover:bg-surface-2">
                  <FileText className="size-4 text-fg-3" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{f.name}</span><span className="text-xs text-fg-3">{f.senderName} · {formatRelative(f.sentAt)} · {formatBytes(f.sizeBytes)}</span></span>
                </a>
              </li>
            ))}
          </ul>
        )
      )}
      {tab === 'ajustes' && (
        <Field label="Notificações desta conversa">
          {(id) => (
            <Select id={id} value={detail.me.notifications} onChange={(e) => act(put(`/conversations/${detail.id}/settings`, { notifications: e.target.value }), 'Preferência salva')}>
              <option value="all">Todas as mensagens</option>
              <option value="mentions">Somente menções</option>
              <option value="none">Nenhuma (silenciar)</option>
            </Select>
          )}
        </Field>
      )}
      <PeoplePicker open={adding} onOpenChange={setAdding} exclude={detail.members.map((m) => m.id)} title="Adicionar participantes" confirmLabel="Adicionar" onConfirm={(ids) => act(post(`/conversations/${detail.id}/members`, { userIds: ids }), 'Participantes adicionados')} />
      <ConfirmDialog open={leaving} onOpenChange={setLeaving} title="Sair do grupo?" description="Você deixará de receber mensagens e não verá mais o histórico deste grupo." tone="danger" confirmLabel="Sair" onConfirm={() => void del(`/conversations/${detail.id}/members/${me.user.id}`).then(() => { void qc.invalidateQueries({ queryKey: ['conversations'] }); navigate('/conversas'); })} />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ new conversation / people picker */

export function PeoplePicker({ open, onOpenChange, exclude = [], title, confirmLabel, onConfirm, single, children }: { open: boolean; onOpenChange: (v: boolean) => void; exclude?: string[]; title: string; confirmLabel: string; onConfirm: (ids: string[]) => void; single?: boolean; children?: ReactNode }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<UserSummary[]>([]);
  const me = useMe();
  const people = useQuery({ queryKey: ['directory', 'picker', q], queryFn: () => get<{ items: UserSummary[] }>(`/directory?pageSize=20&q=${encodeURIComponent(q)}`), enabled: open });
  useEffect(() => {
    if (!open) {
      setQ('');
      setSelected([]);
    }
  }, [open]);
  const list = (people.data?.items ?? []).filter((u) => u.id !== me.user.id && !exclude.includes(u.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} footer={!single && <><Button onClick={() => onOpenChange(false)}>Cancelar</Button><Button variant="primary" disabled={!selected.length} onClick={() => { onConfirm(selected.map((s) => s.id)); onOpenChange(false); }}>{confirmLabel} ({selected.length})</Button></>}>
      {children}
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail" aria-label="Buscar colaboradores" />
      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-text">
              {s.displayName}
              <button aria-label={`Remover ${s.displayName}`} onClick={() => setSelected((l) => l.filter((x) => x.id !== s.id))}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      <ul className="mt-3 max-h-72 space-y-0.5 overflow-y-auto">
        {people.isLoading && <Spinner />}
        {list.map((u) => {
          const on = selected.some((s) => s.id === u.id);
          return (
            <li key={u.id}>
              <button
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2', on && 'bg-surface-2')}
                aria-pressed={on}
                onClick={() => {
                  if (single) {
                    onConfirm([u.id]);
                    onOpenChange(false);
                  } else setSelected((l) => (on ? l.filter((x) => x.id !== u.id) : [...l, u]));
                }}
              >
                <Avatar name={u.displayName} src={u.avatarUrl} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{u.displayName}</span>
                  <span className="block truncate text-xs text-fg-3">{u.jobTitle ?? u.email}</span>
                </span>
                {on && <Check className="size-4 text-brand" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function NewConversationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [name, setName] = useState('');
  const [allowInvite, setAllowInvite] = useState(false);
  const done = (id: string) => {
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    navigate(`/conversas/${id}`);
  };
  return (
    <PeoplePicker
      open={open}
      onOpenChange={onOpenChange}
      single={mode === 'direct'}
      title="Nova conversa"
      confirmLabel="Criar grupo"
      onConfirm={(ids) => {
        if (mode === 'direct') {
          void post<{ id: string }>('/conversations/direct', { userId: ids[0] }).then((r) => done(r.id)).catch((e) => toast.error('Não foi possível iniciar a conversa', e));
        } else {
          if (name.trim().length < 2) return toast.error('Informe o nome do grupo');
          void post<{ id: string }>('/conversations/groups', { name, memberIds: ids, allowMembersInvite: allowInvite }).then((r) => { done(r.id); setName(''); }).catch((e) => toast.error('Não foi possível criar o grupo', e));
        }
      }}
    >
      <div className="mb-4 flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Tipo de conversa">
        {(['direct', 'group'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn('flex-1 rounded-md py-1.5 text-sm font-medium', mode === m ? 'bg-surface shadow-card' : 'text-fg-3')}>
            {m === 'direct' ? 'Individual' : 'Grupo'}
          </button>
        ))}
      </div>
      {mode === 'group' && (
        <div className="mb-4 space-y-3">
          <Field label="Nome do grupo" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Projeto revisão de laudos" />}</Field>
          <label className="flex items-center gap-2 text-[13px] text-fg-2"><Switch label="Participantes podem adicionar pessoas" checked={allowInvite} onCheckedChange={setAllowInvite} /> Participantes podem adicionar pessoas</label>
        </div>
      )}
      <p className="mb-2 text-xs text-fg-3">{mode === 'direct' ? 'Escolha com quem conversar. A política da empresa define quem pode ser contatado.' : 'Selecione os participantes.'}</p>
    </PeoplePicker>
  );
}
