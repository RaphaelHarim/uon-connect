import { INTEGRATION_STATE_LABELS, type IntegrationState } from '@uon/shared/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Notice, Spinner } from '@/components/ui';
import { get, post } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { AdminPage } from './common';

const TONE: Record<IntegrationState, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { not_configured: 'neutral', configured: 'info', healthy: 'success', degraded: 'warning', error: 'danger' };
const NAMES: Record<string, string> = { entra_id: 'Microsoft Entra ID', outlook_calendar: 'Outlook — calendário', teams_meetings: 'Microsoft Teams — reuniões', email: 'E-mail (SMTP)', storage: 'Armazenamento de arquivos', turn: 'Servidor TURN (vídeo)' };

export default function AdminIntegrations() {
  const q = useQuery({ queryKey: ['admin', 'integrations'], queryFn: () => get<{ items: { key: string; description: string; configured: boolean; state: IntegrationState; lastCheckedAt: string | null; lastError: string | null }[]; events: { id: number; integrationKey: string; outcome: string; message: string; occurredAt: string }[] }>('/admin/integrations') });
  const qc = useQueryClient();
  const toast = useToast();
  const check = useMutation({ mutationFn: (key: string) => post<{ state: IntegrationState; detail: string }>(`/admin/integrations/${key}/check`), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['admin', 'integrations'] }); toast.info(`Resultado: ${INTEGRATION_STATE_LABELS[r.state]}`, r.detail); }, onError: (e) => toast.error('Falha na verificação', e) });
  if (!q.data) return <Spinner />;
  return (
    <AdminPage permission="integrations.read" title="Integrações" description="Estado real de cada integração. Nada é exibido como conectado sem configuração e verificação.">
      <div className="mb-5"><Notice tone="neutral">Credenciais (Tenant ID, Client ID, segredos SMTP/TURN) são configuradas por variáveis de ambiente no servidor — nunca pela interface. Veja docs/INTEGRATIONS.md.</Notice></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {q.data.items.map((i) => (
          <Card key={i.key} className="p-4">
            <div className="flex items-start justify-between gap-2"><p className="font-semibold">{NAMES[i.key] ?? i.key}</p><Badge tone={TONE[i.state]}>{INTEGRATION_STATE_LABELS[i.state]}</Badge></div>
            <p className="mt-1 text-[13px] text-fg-3">{i.description}</p>
            {i.lastCheckedAt && <p className="mt-2 text-xs text-fg-3">Última verificação: {formatDateTime(i.lastCheckedAt)}</p>}
            {i.lastError && <p className="mt-1 truncate text-xs text-danger" title={i.lastError}>{i.lastError}</p>}
            <Button size="sm" className="mt-3" icon={<RefreshCw className="size-3.5" />} disabled={!i.configured} loading={check.isPending && check.variables === i.key} onClick={() => check.mutate(i.key)}>Verificar</Button>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader title="Eventos recentes" />
        <ul className="divide-y divide-line text-[13px]">
          {q.data.events.length === 0 && <li className="px-5 py-4 text-fg-3">Sem eventos.</li>}
          {q.data.events.map((e) => <li key={e.id} className="flex gap-3 px-5 py-2"><span className="w-28 shrink-0 text-fg-3">{formatRelative(e.occurredAt)}</span><span className="font-medium">{NAMES[e.integrationKey] ?? e.integrationKey}</span><Badge tone={e.outcome === 'success' ? 'success' : 'danger'}>{e.outcome}</Badge><span className="truncate text-fg-3">{e.message}</span></li>)}
        </ul>
      </Card>
    </AdminPage>
  );
}
