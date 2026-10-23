import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

/** Registers the service worker and asks before activating a new version (never silently). */
export function PwaPrompt() {
  const [update, setUpdate] = useState<null | (() => Promise<void>)>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      const updateSW = registerSW({ onNeedRefresh: () => setUpdate(() => () => updateSW(true)) });
    });
  }, []);
  if (!update) return null;
  return (
    <div role="status" className="fixed bottom-20 left-1/2 z-[60] flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-pop lg:bottom-4">
      <RefreshCw className="size-4 shrink-0 text-brand" aria-hidden />
      <p className="flex-1 text-sm">Uma nova versão do UON CONNECT está disponível.</p>
      <Button size="sm" variant="primary" onClick={() => void update()}>
        Atualizar
      </Button>
    </div>
  );
}
