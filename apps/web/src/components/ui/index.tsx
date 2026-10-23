import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import { Dialog as RDialog, Switch as RSwitch, Tabs as RTabs } from 'radix-ui';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { PRESENCE_LABELS, type PresenceStatus } from '@uon/shared/browser';

/* ------------------------------------------------------------------ Button */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover shadow-card',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2 shadow-card',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg',
  subtle: 'bg-surface-2 text-fg hover:bg-surface-3',
  danger: 'bg-danger text-white hover:opacity-90',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
  icon: 'h-9 w-9 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-lg font-medium whitespace-nowrap transition-colors duration-150 select-none',
        'disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Form fields */

const fieldBase =
  'rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-3 transition-colors focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-60 aria-[invalid=true]:border-danger';

/** Fields are full width unless the caller passes its own width class. */
const width = (className?: string) => (className && /(^|\s)(w-|flex-1)/.test(className) ? undefined : 'w-full');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldBase, 'h-9', width(className), className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-24 py-2 leading-relaxed', width(className), className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-9 pr-8', width(className), className)} {...p}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, required, className }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; required?: boolean; className?: string }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-fg">
        {label}
        {required && <span className="text-danger" aria-hidden> *</span>}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && !error && <p id={hintId} className="text-xs text-fg-3">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-brand disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

/* ------------------------------------------------------------------ Surfaces */

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumbs && <div className="mb-1.5 text-[13px] text-fg-3">{breadcrumbs}</div>}
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Feedback */

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-2 border-line',
  brand: 'bg-brand-soft text-brand-text border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
};

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Status pill using the configurable colour from the database, plus the label (never colour alone). */
export function ColorBadge({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-fg-2">
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

export function Spinner({ label = 'Carregando…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-fg-3', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden />;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-2 text-fg-3">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-fg-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { message?: string; correlationId?: string; status?: number };
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="font-medium text-fg">{e?.status === 404 ? 'Não encontrado' : 'Não foi possível carregar'}</p>
      <p className="mt-1 max-w-md text-[13px] text-fg-3">{e?.message ?? 'Erro inesperado.'}</p>
      {e?.correlationId && <p className="mt-1 font-mono text-[11px] text-fg-3">Código: {e.correlationId}</p>}
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, icon }: { tone?: Tone; title?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-[13px]', tones[tone])}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-fg-2">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ People */

const PRESENCE_COLORS: Record<PresenceStatus, string> = {
  available: 'bg-[#16a34a]',
  busy: 'bg-[#dc2626]',
  dnd: 'bg-[#dc2626]',
  away: 'bg-[#d97706]',
  offline: 'bg-[#9ca3af]',
};

export function PresenceDot({ status, className }: { status: PresenceStatus; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 rounded-full ring-2 ring-surface', PRESENCE_COLORS[status], status === 'dnd' && 'after:block', className)}
      title={PRESENCE_LABELS[status]}
      aria-label={PRESENCE_LABELS[status]}
      role="img"
    />
  );
}

export function Avatar({ name, src, size = 32, presence }: { name: string; src?: string | null; size?: number; presence?: PresenceStatus | null }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" className="size-full rounded-full object-cover" loading="lazy" />
      ) : (
        <span
          aria-hidden
          className="flex size-full items-center justify-center rounded-full font-semibold text-white"
          style={{ background: `hsl(${hue} 32% 42%)`, fontSize: size * 0.38 }}
        >
          {initials(name)}
        </span>
      )}
      {presence && <PresenceDot status={presence} className="absolute -right-0.5 -bottom-0.5" />}
    </span>
  );
}

/* ------------------------------------------------------------------ Dialog */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in" />
        <RDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-pop animate-pop-in',
            { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RDialog.Title className="text-base font-semibold">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-0.5 text-[13px] text-fg-3">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Fechar" className="-mr-2 -mt-1">
                <X className="size-4" />
              </Button>
            </RDialog.Close>
          </div>
          <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  tone = 'primary',
  onConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Tabs */

export function Tabs({ value, onValueChange, items, children }: { value: string; onValueChange: (v: string) => void; items: { value: string; label: ReactNode; count?: number }[]; children?: ReactNode }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className="scrollbar-thin -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="Seções">
        {items.map((it) => (
          <RTabs.Trigger
            key={it.value}
            value={it.value}
            className="relative -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap text-fg-3 transition-colors hover:text-fg data-[state=active]:border-brand data-[state=active]:text-fg"
          >
            {it.label}
            {it.count !== undefined && <span className="rounded bg-surface-2 px-1.5 text-xs text-fg-2">{it.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

/* ------------------------------------------------------------------ Pagination */

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-fg-3">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <span aria-current="page">
          Página {page} de {pages}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ Stat */

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-fg-2">{label}</p>
        {icon && <span className={cn('rounded-md p-1.5', tone ? tones[tone] : 'bg-surface-2 text-fg-3')}>{icon}</span>}
      </div>
      <p className="mt-2 text-[28px] leading-none font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      {hint && <p className="mt-2 text-xs text-fg-3">{hint}</p>}
    </Card>
  );
}

export { RTabs as TabsPrimitive };
