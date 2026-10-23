import { PRESENCE_LABELS, PRESENCE_STATUSES, type PresenceStatus } from '@uon/shared/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Monitor,
  Moon,
  Search,
  Shield,
  Sun,
  Ticket,
  User,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Avatar, Badge, Button } from '@/components/ui';
import { get, put } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { usePresence, useConnection } from '@/lib/realtime';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { CommandPalette } from './CommandPalette';

export function BrandMark({ compact }: { compact?: boolean }) {
  const { config } = useAuth();
  if (config?.brand.logoUrl) return <img src={config.brand.logoUrl} alt="UON Consulting" className="h-7 w-auto max-w-[150px] object-contain" />;
  // No official logo configured: a plain wordmark in type, never an invented logo.
  return (
    <span className="flex items-baseline gap-1.5 leading-none select-none">
      <span className="text-[17px] font-bold tracking-[0.14em] text-fg">UON</span>
      {!compact && <span className="text-[17px] font-light tracking-[0.14em] text-brand-text">CONNECT</span>}
    </span>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  show?: boolean;
}

function useNav(): NavItem[] {
  const { can } = useAuth();
  const adminArea = can('users.manage') || can('org.manage') || can('audit.read') || can('admin.dashboard');
  return [
    { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
    { to: '/chamados', label: 'Chamados', icon: Ticket },
    { to: '/conversas', label: 'Conversas', icon: MessagesSquare },
    { to: '/reunioes', label: 'Reuniões', icon: CalendarClock },
    { to: '/pessoas', label: 'Pessoas', icon: Users },
    { to: '/organizacao', label: 'Organização', icon: Building2 },
    { to: '/admin', label: 'Administração', icon: Shield, show: adminArea },
  ].filter((i) => i.show !== false);
}

function UnreadBadge({ n }: { n: number }) {
  if (!n) return null;
  return <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] leading-[18px] font-semibold text-on-brand tabular-nums">{n > 99 ? '99+' : n}</span>;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNav();
  const convs = useQuery({ queryKey: ['conversations'], queryFn: () => get<{ unread: number }[]>('/conversations'), staleTime: 15_000 });
  const unreadChat = (convs.data ?? []).reduce((s, c) => s + c.unread, 0);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-5">
        <BrandMark />
      </div>
      <nav aria-label="Navegação principal" className="flex-1 space-y-0.5 px-3 py-2">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-brand-soft text-brand-text' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            <item.icon className="size-[18px] shrink-0" aria-hidden />
            {item.label}
            {item.to === '/conversas' && <UnreadBadge n={unreadChat} />}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-line px-5 py-4">
        <p className="text-[10px] font-semibold tracking-[0.18em] text-fg-3 uppercase">Patrimônio de UON Consulting</p>
        <p className="mt-1 text-[11px] text-fg-3">Uso interno e restrito.</p>
      </div>
    </div>
  );
}

function NotificationBell() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => get<{ unread: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const n = q.data?.unread ?? 0;
  return (
    <Button variant="ghost" size="icon" aria-label={n ? `Notificações: ${n} não lidas` : 'Notificações'} onClick={() => navigate('/notificacoes')} className="relative">
      <Bell className="size-[18px]" />
      {n > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand ring-2 ring-surface" aria-hidden />}
    </Button>
  );
}

function ProfileMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const presence = usePresence(me.user.id);
  const setStatus = useMutation({
    mutationFn: (status: PresenceStatus | null) => put('/me/presence', { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['presence'] });
      toast.success('Status atualizado');
    },
    onError: (e) => toast.error('Não foi possível alterar o status', e),
  });
  const saveTheme = (t: 'system' | 'light' | 'dark') => {
    setTheme(t);
    void put('/me/preferences', { theme: t }).catch(() => undefined);
  };
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-2';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2" aria-label="Menu do perfil">
          <Avatar name={me.user.displayName} src={me.user.avatarUrl} size={30} presence={presence?.status ?? null} />
          <span className="hidden max-w-[140px] truncate text-sm font-medium md:block">{me.user.displayName}</span>
          <ChevronDown className="hidden size-4 text-fg-3 md:block" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-pop animate-pop-in">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold">{me.user.displayName}</p>
            <p className="truncate text-xs text-fg-3">{me.user.email}</p>
            {presence && (
              <p className="mt-1 text-xs text-fg-2">
                {PRESENCE_LABELS[presence.status]}
                {presence.source === 'manual' ? ' (definido por você)' : presence.source === 'absence' ? ' (ausência programada)' : ' (automático)'}
              </p>
            )}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">Status</DropdownMenu.Label>
          {PRESENCE_STATUSES.map((s) => (
            <DropdownMenu.Item key={s} className={item} onSelect={() => setStatus.mutate(s)}>
              <span className={cn('size-2.5 rounded-full', { available: 'bg-[#16a34a]', busy: 'bg-[#dc2626]', dnd: 'bg-[#dc2626]', away: 'bg-[#d97706]', offline: 'bg-[#9ca3af]' }[s])} aria-hidden />
              {s === 'offline' ? 'Aparecer offline' : PRESENCE_LABELS[s]}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Item className={item} onSelect={() => setStatus.mutate(null)}>
            <span className="size-2.5 rounded-full border border-fg-3" aria-hidden />
            Automático (conforme conexão)
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">Tema</DropdownMenu.Label>
          <div className="flex gap-1 px-1.5 pb-1">
            {([['light', Sun, 'Claro'], ['dark', Moon, 'Escuro'], ['system', Monitor, 'Sistema']] as const).map(([t, Icon, label]) => (
              <button key={t} onClick={() => saveTheme(t)} aria-pressed={theme === t} className={cn('flex flex-1 flex-col items-center gap-1 rounded-md py-1.5 text-[11px]', theme === t ? 'bg-brand-soft text-brand-text' : 'text-fg-2 hover:bg-surface-2')}>
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={item} onSelect={() => navigate('/perfil')}>
            <User className="size-4 text-fg-3" aria-hidden /> Meu perfil e ausências
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => void logout()}>
            <LogOut className="size-4 text-fg-3" aria-hidden /> Sair
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ConnectionBanner() {
  const conn = useConnection();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online && (conn === 'connected' || conn === 'connecting')) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-center text-[13px] text-warning">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      {!online
        ? 'Você está sem conexão. Mensagens e chamados não serão enviados até a conexão voltar.'
        : 'Tempo real indisponível — tentando reconectar. As páginas continuam funcionando; atualize para ver novidades.'}
      {online && (
        <button className="font-semibold underline" onClick={() => location.reload()}>
          Atualizar
        </button>
      )}
    </div>
  );
}

function DemoBanner() {
  const { config, me } = useAuth();
  if (!config?.demoData && !me?.user.isDemo) return null;
  return (
    <div className="bg-info-soft px-4 py-1 text-center text-[12px] font-medium text-info">
      Ambiente de demonstração — pessoas, chamados e mensagens exibidos são fictícios.
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const nav = useNav();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-pop animate-pop-in">
            <Button variant="ghost" size="icon" className="absolute top-2.5 right-2" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}>
              <X className="size-5" />
            </Button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <ConnectionBanner />
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <div className="lg:hidden">
            <BrandMark compact />
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-9 min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm text-fg-3 hover:border-line-strong sm:ml-0 sm:w-80"
            aria-label="Pesquisar (Ctrl+K)"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="hidden truncate sm:inline">Pesquisar chamados, pessoas…</span>
            <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-surface px-1.5 text-[11px] font-medium whitespace-nowrap sm:inline">Ctrl K</kbd>
          </button>
          <div className="flex items-center gap-1 sm:ml-auto">
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>
        <main id="conteudo" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>
        <MobileTabBar items={nav.slice(0, 4)} />
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function MobileTabBar({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Navegação rápida" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-text' : 'text-fg-3')}>
          <item.icon className="size-5" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function PageContainer({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:py-8', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>{children}</div>;
}

export { Badge };
