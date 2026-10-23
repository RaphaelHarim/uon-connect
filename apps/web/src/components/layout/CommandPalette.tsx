import type { UserSummary } from '@uon/shared/browser';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Search, Ticket, User } from 'lucide-react';
import { Dialog as RDialog } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, Spinner } from '@/components/ui';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';

interface SearchResult {
  tickets: { id: string; protocol: string; title: string; status: { label: string } }[];
  people: UserSummary[];
  conversations: { id: string; name: string | null; type: string }[];
  messages: { id: string; conversationId: string; conversationName: string | null; senderName: string | null; body: string }[];
}

function useDebounced<T>(v: T, ms = 220) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Global search (Ctrl+K). Results come from the server and respect each user's permissions. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const r = useQuery({ queryKey: ['search', term], queryFn: ({ signal }) => get<SearchResult>(`/search?q=${encodeURIComponent(term)}`, signal), enabled: open && term.length >= 2 });

  type Item = { key: string; group: string; icon: typeof Ticket; title: string; sub: string; to: string; person?: UserSummary };
  const items = useMemo((): Item[] => {
    const d = r.data;
    if (!d) return [];
    return [
      ...d.tickets.map((t) => ({ key: `t${t.id}`, group: 'Chamados', icon: Ticket, title: `${t.protocol} · ${t.title}`, sub: t.status.label, to: `/chamados/${t.id}` })),
      ...d.people.map((p) => ({ key: `p${p.id}`, group: 'Pessoas', icon: User, title: p.displayName, sub: p.jobTitle ?? p.email, to: `/pessoas/${p.id}`, person: p })),
      ...d.conversations.map((c) => ({ key: `c${c.id}`, group: 'Conversas', icon: MessageSquare, title: c.name ?? 'Conversa', sub: c.type === 'group' ? 'Grupo' : 'Conversa individual', to: `/conversas/${c.id}` })),
      ...d.messages.map((m) => ({ key: `m${m.id}`, group: 'Mensagens', icon: MessageSquare, title: m.body, sub: `${m.senderName ?? ''} em ${m.conversationName ?? 'conversa'}`, to: `/conversas/${m.conversationId}?msg=${m.id}` })),
    ];
  }, [r.data]);

  useEffect(() => setActive(0), [items.length]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  let lastGroup = '';
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in" />
        <RDialog.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-pop-in">
          <RDialog.Title className="sr-only">Pesquisa global</RDialog.Title>
          <RDialog.Description className="sr-only">Pesquise chamados, pessoas, conversas e mensagens que você tem permissão para ver.</RDialog.Description>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search className="size-4 text-fg-3" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter' && items[active]) go(items[active].to);
              }}
              placeholder="Pesquisar por protocolo, título, nome ou mensagem…"
              aria-label="Termo de pesquisa"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="palette-results"
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
            />
          </div>
          <div id="palette-results" role="listbox" className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
            {term.length < 2 && <p className="px-3 py-6 text-center text-[13px] text-fg-3">Digite pelo menos 2 caracteres. Os resultados respeitam suas permissões.</p>}
            {term.length >= 2 && r.isFetching && !r.data && <Spinner />}
            {term.length >= 2 && r.data && items.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-fg-3">Nada encontrado para “{term}”.</p>}
            {items.map((it, i) => {
              const header = it.group !== lastGroup;
              lastGroup = it.group;
              return (
                <div key={it.key}>
                  {header && <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">{it.group}</p>}
                  <button
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(it.to)}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-surface-2')}
                  >
                    {it.person ? <Avatar name={it.person.displayName} src={it.person.avatarUrl} size={26} /> : <it.icon className="size-4 shrink-0 text-fg-3" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{it.title}</span>
                      <span className="block truncate text-xs text-fg-3">{it.sub}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
