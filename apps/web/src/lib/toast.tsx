import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from './cn';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

const Ctx = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = Date.now() + Math.random();
      setItems((l) => [...l.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? TriangleAlert : Info;
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex gap-3 rounded-lg border border-line bg-surface p-3 shadow-pop animate-pop-in">
              <Icon className={cn('mt-0.5 size-4 shrink-0', t.tone === 'success' && 'text-success', t.tone === 'error' && 'text-danger', t.tone === 'info' && 'text-info')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] break-words text-fg-3">{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-fg-3 hover:text-fg" aria-label="Fechar aviso">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('ToastProvider ausente');
  return {
    success: (title: string, description?: string) => ctx.push({ tone: 'success', title, description }),
    error: (title: string, err?: unknown) =>
      ctx.push({ tone: 'error', title, description: err instanceof Error ? err.message : typeof err === 'string' ? err : undefined }),
    info: (title: string, description?: string) => ctx.push({ tone: 'info', title, description }),
  };
}
