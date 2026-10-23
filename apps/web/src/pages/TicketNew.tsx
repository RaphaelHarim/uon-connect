import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Info, Lock, Paperclip, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { PageContainer } from '@/components/layout/AppShell';
import { Button, Card, ErrorState, Field, Input, Notice, PageHeader, Select, Spinner, Switch, Textarea } from '@/components/ui';
import { get, post, upload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBytes } from '@/lib/format';
import { useToast } from '@/lib/toast';

interface FormOptions {
  categories: { id: string; name: string; description: string | null; serviceDepartmentId: string | null; defaultConfidential: boolean }[];
  priorities: { key: string; label: string }[];
  clients: { id: string; name: string }[];
  destinations: { destination: 'team' | 'department_head' | 'service_desk'; targetId: string; label: string; departmentId: string }[];
}

const schema = z.object({
  title: z.string().trim().min(4, 'Informe um título com pelo menos 4 caracteres.').max(160),
  description: z.string().trim().min(1, 'Descreva a solicitação.').max(10_000),
  categoryId: z.string().min(1, 'Escolha uma categoria.'),
  priority: z.string().min(1),
  destination: z.string().min(1, 'Escolha para quem enviar.'),
  confidential: z.boolean(),
});
type Values = z.infer<typeof schema>;

export default function TicketNewPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { config } = useAuth();
  const opts = useQuery({ queryKey: ['tickets', 'form-options'], queryFn: () => get<FormOptions>('/tickets/form-options') });
  const [files, setFiles] = useState<File[]>([]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: '', description: '', categoryId: '', priority: 'medium', destination: '', confidential: false } });
  const categoryId = form.watch('categoryId');
  const category = opts.data?.categories.find((c) => c.id === categoryId);

  // Categories bound to a service desk route there automatically (the server enforces the same rule).
  const destinations = useMemo(() => {
    const all = opts.data?.destinations ?? [];
    if (category?.serviceDepartmentId) return all.filter((d) => d.destination === 'service_desk' && d.targetId === category.serviceDepartmentId);
    return all;
  }, [opts.data, category]);

  useEffect(() => {
    if (category?.serviceDepartmentId) {
      const d = destinations[0];
      if (d) form.setValue('destination', `${d.destination}:${d.targetId}`);
    }
    if (category) form.setValue('confidential', category.defaultConfidential);
  }, [category, destinations, form]);

  const create = useMutation({
    mutationFn: async (v: Values) => {
      const [destination, targetId] = v.destination.split(':');
      const t = await post<{ id: string; protocol: string }>('/tickets', { title: v.title, description: v.description, categoryId: v.categoryId, priority: v.priority, destination, targetId, confidential: v.confidential });
      const failed: string[] = [];
      for (const f of files) {
        try {
          await upload(`/tickets/${t.id}/attachments`, f);
        } catch (e) {
          failed.push(`${f.name}: ${(e as Error).message}`);
        }
      }
      return { ...t, failed };
    },
    onSuccess: (t) => {
      toast.success(`Chamado ${t.protocol} aberto`, 'Você será notificado a cada atualização.');
      if (t.failed.length) toast.error('Alguns anexos não foram enviados', t.failed.join('\n'));
      navigate(`/chamados/${t.id}`);
    },
    onError: (e) => toast.error('Não foi possível abrir o chamado', e),
  });

  if (opts.error) return <ErrorState error={opts.error} onRetry={() => opts.refetch()} />;
  if (!opts.data) return <Spinner />;
  const max = config?.uploads.maxFileSizeBytes ?? 20 * 1024 * 1024;
  const err = form.formState.errors;

  return (
    <PageContainer>
      <PageHeader title="Abrir chamado" breadcrumbs={<Link to="/chamados" className="hover:underline">Chamados</Link>} description="Descreva a solicitação com clareza. O destino disponível depende das suas equipes e da categoria." />
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="grid gap-6 lg:grid-cols-3" noValidate>
        <Card className="space-y-5 p-5 lg:col-span-2">
          <Field label="Título" required error={err.title?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!err.title} placeholder="Ex.: Acesso à pasta compartilhada da carteira" {...form.register('title')} />}
          </Field>
          <Field label="Descrição" required error={err.description?.message} hint="Inclua o que aconteceu, desde quando, e o impacto no trabalho.">
            {(id, d) => <Textarea id={id} aria-describedby={d} aria-invalid={!!err.description} rows={7} {...form.register('description')} />}
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Anexos</p>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-5 text-[13px] text-fg-2 hover:bg-surface-2">
              <Paperclip className="size-4" aria-hidden />
              Selecionar arquivos (até {formatBytes(max)} cada)
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const picked = [...(e.target.files ?? [])];
                  const tooBig = picked.filter((f) => f.size > max);
                  if (tooBig.length) toast.error('Arquivo acima do limite', tooBig.map((f) => f.name).join(', '));
                  setFiles((l) => [...l, ...picked.filter((f) => f.size <= max)].slice(0, 10));
                  e.target.value = '';
                }}
              />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-1.5 text-[13px]">
                    <span className="truncate">{f.name} <span className="text-fg-3">· {formatBytes(f.size)}</span></span>
                    <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                      <X className="size-4 text-fg-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-xs text-fg-3">Formatos aceitos: imagens, PDF, documentos do Office, TXT, CSV e ZIP. O tipo real do arquivo é verificado no servidor.</p>
          </div>
        </Card>
        <div className="space-y-5">
          <Card className="space-y-5 p-5">
            <Field label="Categoria" required error={err.categoryId?.message}>
              {(id) => (
                <Select id={id} aria-invalid={!!err.categoryId} {...form.register('categoryId')}>
                  <option value="">Selecione…</option>
                  {opts.data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {category?.description && <p className="-mt-3 text-xs text-fg-3">{category.description}</p>}
            <Field label="Enviar para" required error={err.destination?.message}>
              {(id) => (
                <Select id={id} aria-invalid={!!err.destination} disabled={!!category?.serviceDepartmentId} {...form.register('destination')}>
                  <option value="">Selecione…</option>
                  {destinations.map((d) => (
                    <option key={`${d.destination}:${d.targetId}`} value={`${d.destination}:${d.targetId}`}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {category?.serviceDepartmentId && <Notice tone="info" icon={<Info className="size-4" />}>Esta categoria é atendida diretamente pela central do departamento responsável.</Notice>}
            <Field label="Prioridade">
              {(id) => (
                <Select id={id} {...form.register('priority')}>
                  {opts.data.priorities.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex items-start justify-between gap-3 rounded-lg bg-surface-2 p-3">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-medium"><Lock className="size-3.5" aria-hidden /> Confidencial</p>
                <p className="text-xs text-fg-3">Oculta o chamado da sua coordenação e do responsável do seu departamento. Somente você e quem atende verão o conteúdo.</p>
              </div>
              <Switch label="Chamado confidencial" checked={form.watch('confidential')} onCheckedChange={(v) => form.setValue('confidential', v)} />
            </div>
          </Card>
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={create.isPending}>
            Abrir chamado
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
