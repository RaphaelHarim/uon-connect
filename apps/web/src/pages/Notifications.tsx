import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS } from '@uon/shared/browser';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, ErrorState, PageHeader, Select, Spinner, Switch } from '@/components/ui';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';

interface Notif {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  count: number;
  readAt: string | null;
  updatedAt: string;
}

export default function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const category = params.get('categoria') ?? '';
  const unreadOnly = params.get('naoLidas') === '1';
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list', category, unreadOnly],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => get<{ items: Notif[]; hasMore: boolean; unread: number }>(`/notifications?limit=30${category ? `&category=${category}` : ''}${unreadOnly ? '&unreadOnly=true' : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.hasMore ? last.items.at(-1)?.updatedAt : undefined),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: refresh });
  const open = async (n: Notif) => {
    if (!n.readAt) await post(`/notifications/${n.id}/read`).catch(() => undefined);
    void refresh();
    if (n.link) navigate(n.link);
  };
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <PageContainer>
      <PageHeader title="Notificações" description="Atualizações de chamados, mensagens, convites e prazos. Ajuste o que recebe em Meu perfil." actions={<Button icon={<CheckCheck className="size-4" />} onClick={() => readAll.mutate()} loading={readAll.isPending}>Marcar todas como lidas</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Select aria-label="Categoria" value={category} onChange={(e) => set('categoria', e.target.value || null)} className="w-auto">
            <option value="">Todas as categorias</option>
            {NOTIFICATION_CATEGORIES.map((c) => <option key={c} value={c}>{NOTIFICATION_CATEGORY_LABELS[c]}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-[13px] text-fg-2"><Switch label="Somente não lidas" checked={unreadOnly} onCheckedChange={(v) => set('naoLidas', v ? '1' : null)} /> Somente não lidas</label>
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : items.length === 0 ? (
          <EmptyState icon={<Bell className="size-5" />} title="Nada por aqui" description="Você está em dia." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id}>
                <button onClick={() => void open(n)} className={cn('flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-surface-2', !n.readAt && 'bg-brand-soft/30')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} aria-label={n.readAt ? undefined : 'Não lida'} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}{n.count > 1 && <span className="ml-1.5 text-xs font-normal text-fg-3">({n.count})</span>}</span>
                    {n.body && <span className="block truncate text-[13px] text-fg-3">{n.body}</span>}
                    <span className="text-xs text-fg-3">{NOTIFICATION_CATEGORY_LABELS[n.category as keyof typeof NOTIFICATION_CATEGORY_LABELS]} · {formatRelative(n.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.hasNextPage && <div className="border-t border-line p-3 text-center"><Button size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</Button></div>}
      </Card>
    </PageContainer>
  );
}
