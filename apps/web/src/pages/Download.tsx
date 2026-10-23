import { useQuery } from '@tanstack/react-query';
import { Apple, Download as DownloadIcon, Globe, Monitor, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '@/components/layout/AppShell';
import { Button, Spinner } from '@/components/ui';
import { get } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { promptInstall, useCanInstall } from '@/lib/install';

type Platform = 'windows' | 'mac' | 'android';
interface Installer {
  platform: Platform;
  label: string;
  fileName: string;
  url: string;
  version: string | null;
  size: number;
  sha256: string;
  uploadedAt: string;
}

function detect(): Platform | 'ios' | null {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  return null;
}

const INFO: Record<Platform, { title: string; icon: ReactNode; steps: ReactNode[] }> = {
  windows: {
    title: 'Windows',
    icon: <Monitor className="size-5" aria-hidden />,
    steps: [
      'Abra o arquivo baixado (UON-CONNECT-Setup.exe).',
      <>Se aparecer “O Windows protegeu o computador”, clique em <b>Mais informações</b> › <b>Executar assim mesmo</b>.</>,
      'O UON CONNECT abre sozinho e fica no menu Iniciar e na área de trabalho.',
    ],
  },
  mac: {
    title: 'Mac',
    icon: <Apple className="size-5" aria-hidden />,
    steps: [
      'Abra o arquivo baixado e arraste o UON CONNECT para a pasta Aplicativos.',
      <>Na primeira vez, se o Mac bloquear, vá em <b>Ajustes do Sistema › Privacidade e Segurança</b> e clique em <b>Abrir Mesmo Assim</b>.</>,
    ],
  },
  android: {
    title: 'Android',
    icon: <Smartphone className="size-5" aria-hidden />,
    steps: [
      'Toque no arquivo baixado (UON-CONNECT.apk).',
      <>Se o celular pedir, permita <b>instalar apps desta fonte</b> para o navegador e volte.</>,
      'Toque em Instalar. O ícone aparece na tela do celular.',
    ],
  },
};

function InstallerCard({ item, platform, primary }: { item?: Installer; platform: Platform; primary?: boolean }) {
  const info = INFO[platform];
  return (
    <div className={`rounded-2xl border bg-surface p-5 ${primary ? 'border-brand shadow-card' : 'border-line'}`}>
      <div className="flex items-center gap-2.5">
        <span className="text-fg-2">{info.icon}</span>
        <h2 className="font-semibold">{info.title}</h2>
        {primary && <span className="ml-auto text-[12px] text-fg-3">Seu aparelho</span>}
      </div>
      {item ? (
        <>
          <a href={item.url} download className="mt-4 block">
            <Button variant={primary ? 'primary' : 'secondary'} size={primary ? 'lg' : 'md'} className="w-full justify-center" icon={<DownloadIcon className="size-4" />}>
              Baixar para {info.title}
            </Button>
          </a>
          <p className="mt-2 text-[12px] text-fg-3">
            {item.version ? `Versão ${item.version} · ` : ''}
            {formatBytes(item.size)} · publicado em {formatDateTime(item.uploadedAt)}
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-fg-2">
            {info.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <details className="mt-3 text-[12px] text-fg-3">
            <summary className="cursor-pointer">Verificação do arquivo (SHA-256)</summary>
            <code className="mt-1 block font-mono break-all select-all">{item.sha256}</code>
          </details>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-fg-3">Instalador ainda não publicado pela administração.</p>
      )}
    </div>
  );
}

export default function DownloadPage() {
  const q = useQuery({ queryKey: ['downloads'], queryFn: () => get<{ items: Installer[] }>('/downloads') });
  const canInstallPwa = useCanInstall();
  const mine = detect();
  const byPlatform = new Map(q.data?.items.map((i) => [i.platform, i]));
  const order: Platform[] = (['windows', 'mac', 'android'] as Platform[]).sort((a, b) => Number(b === mine) - Number(a === mine));

  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="text-2xl font-semibold">Instale o UON CONNECT</h1>
          <p className="max-w-lg text-sm text-fg-2">
            Baixe o aplicativo para o seu aparelho. Para entrar, use o convite que você recebeu da administração.
          </p>
        </div>

        {q.isLoading && <Spinner />}
        {q.data && (
          <div className="space-y-4">
            {mine === 'ios' && (
              <div className="rounded-2xl border border-brand bg-surface p-5 shadow-card">
                <div className="flex items-center gap-2.5">
                  <Apple className="size-5 text-fg-2" aria-hidden />
                  <h2 className="font-semibold">iPhone e iPad</h2>
                </div>
                <p className="mt-2 text-[13px] text-fg-2">A Apple não permite instalar aplicativos fora da App Store. O UON CONNECT é instalado pelo Safari:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-fg-2">
                  <li>Abra esta página no <b>Safari</b>.</li>
                  <li>Toque em <b>Compartilhar</b> (quadrado com seta para cima).</li>
                  <li>Toque em <b>Adicionar à Tela de Início</b> › <b>Adicionar</b>.</li>
                </ol>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {order.map((p, i) => (
                <div key={p} className={i === 0 && mine === p ? 'sm:col-span-2' : ''}>
                  <InstallerCard platform={p} item={byPlatform.get(p)} primary={mine === p} />
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center gap-2.5">
                <Globe className="size-5 text-fg-2" aria-hidden />
                <h2 className="font-semibold">Sem baixar nada</h2>
              </div>
              <p className="mt-2 text-[13px] text-fg-2">
                O UON CONNECT também funciona direto no navegador.{' '}
                {canInstallPwa ? 'Este navegador permite instalá-lo como aplicativo:' : 'No Edge ou no Chrome, use o ícone “Instalar” da barra de endereço.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {canInstallPwa && (
                  <Button onClick={() => void promptInstall()} icon={<DownloadIcon className="size-4" />}>
                    Instalar pelo navegador
                  </Button>
                )}
                <Link to="/login">
                  <Button variant="ghost">Entrar no navegador</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
        <p className="mt-10 text-center text-[11px] tracking-[0.16em] text-fg-3 uppercase">Patrimônio de UON Consulting · Uso interno</p>
      </div>
    </div>
  );
}
