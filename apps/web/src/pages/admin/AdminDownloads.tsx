import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, Notice } from '@/components/ui';
import { del, get, upload } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { AdminPage } from './common';

type Platform = 'windows' | 'mac' | 'android';
interface Installer { platform: Platform; version: string | null; size: number; sha256: string; uploadedAt: string }

const PLATFORMS: { id: Platform; label: string; ext: string; hint: string }[] = [
  { id: 'windows', label: 'Windows', ext: '.exe', hint: 'Arquivo "UON CONNECT Setup x.y.z.exe" gerado pelo build do aplicativo de computador.' },
  { id: 'mac', label: 'Mac', ext: '.dmg', hint: 'Arquivo "UON CONNECT-x.y.z.dmg".' },
  { id: 'android', label: 'Android', ext: '.apk', hint: 'Arquivo "UON-CONNECT.apk" gerado pelo build do aplicativo Android.' },
];

function PlatformRow({ p, current }: { p: (typeof PLATFORMS)[number]; current?: Installer }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['downloads'] });
  const send = async (file?: File) => {
    if (!file) return;
    setProgress(0);
    try {
      await upload(`/admin/downloads/${p.id}`, file, setProgress, version.trim() ? { version: version.trim() } : {});
      toast.success(`Instalador para ${p.label} publicado`);
      setVersion('');
      refresh();
    } catch (e) {
      toast.error('Envio recusado', e);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };
  const remove = useMutation({ mutationFn: () => del(`/admin/downloads/${p.id}`), onSuccess: () => { setConfirm(false); refresh(); toast.success('Instalador removido'); } });

  return (
    <Card>
      <CardHeader title={p.label} description={p.hint} actions={current ? <Badge tone="success">Publicado</Badge> : <Badge>Não publicado</Badge>} />
      <div className="space-y-3 p-5 text-[13px]">
        {current && (
          <p className="text-fg-2">
            {current.version ? `Versão ${current.version} · ` : ''}{formatBytes(current.size)} · {formatDateTime(current.uploadedAt)}
            <code className="mt-1 block font-mono text-[11px] break-all text-fg-3">SHA-256 {current.sha256}</code>
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Versão (opcional)" className="w-40">
            {(id) => <Input id={id} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />}
          </Field>
          <input ref={input} type="file" accept={p.ext} className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
          <Button variant="primary" icon={<Upload className="size-4" />} loading={progress !== null} onClick={() => input.current?.click()}>
            {current ? 'Substituir arquivo' : `Enviar ${p.ext}`}
          </Button>
          {current && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)}>Remover</Button>}
        </div>
        {progress !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Envio do instalador" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Remover o instalador para ${p.label}?`} description="A página de download deixa de oferecer este arquivo. Quem já instalou não é afetado." tone="danger" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </Card>
  );
}

export default function AdminDownloads() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['downloads'], queryFn: () => get<{ items: Installer[] }>('/downloads') });
  const link = `${window.location.origin}/baixar`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar; selecione o link e copie manualmente.');
    }
  };
  return (
    <AdminPage permission="settings.manage" title="Instaladores" description="Arquivos oferecidos na página de download. Quem instala ainda precisa de convite para entrar.">
      <div className="mb-6">
        <Notice tone="info" title="Link para enviar às pessoas">
          <div className="mt-1 flex max-w-xl gap-2">
            <Input readOnly value={link} aria-label="Link da página de download" onFocus={(e) => e.currentTarget.select()} />
            <Button size="icon" aria-label="Copiar link" onClick={() => void copy()}><Copy className="size-4" /></Button>
          </div>
        </Notice>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {PLATFORMS.map((p) => <PlatformRow key={p.id} p={p} current={q.data?.items.find((i) => i.platform === p.id)} />)}
      </div>
      <p className="mt-4 text-[13px] text-fg-3">iPhone e iPad não aceitam instaladores fora da App Store; a página de download mostra como adicionar à Tela de Início pelo Safari.</p>
    </AdminPage>
  );
}
