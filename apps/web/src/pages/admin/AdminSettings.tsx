import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Select, Spinner } from '@/components/ui';
import { get, put } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { AdminPage } from './common';

interface Settings { chatDirectPolicy: 'company' | 'department'; chatGroupCreation: 'everyone' | 'leaders'; ticketReopenWindowDays: number; ticketAutoCloseResolvedDays: number }

export default function AdminSettings() {
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => get<Settings>('/admin/settings') });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({ mutationFn: () => put('/admin/settings', s), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); toast.success('Políticas atualizadas'); }, onError: (e) => toast.error('Não foi possível salvar', e) });
  if (!s) return <Spinner />;
  return (
    <AdminPage permission="settings.manage" title="Políticas da plataforma" description="Regras aplicadas pelo servidor a todos os usuários.">
      <Card className="max-w-2xl space-y-5 p-5">
        <Field label="Conversas individuais" hint="Define quem pode iniciar uma conversa privada com quem.">
          {(id, d) => <Select id={id} aria-describedby={d} value={s.chatDirectPolicy} onChange={(e) => setS({ ...s, chatDirectPolicy: e.target.value as Settings['chatDirectPolicy'] })}><option value="company">Qualquer colaborador ativo da empresa</option><option value="department">Somente colegas do mesmo departamento (líderes falam com todos)</option></Select>}
        </Field>
        <Field label="Criação de grupos">
          {(id) => <Select id={id} value={s.chatGroupCreation} onChange={(e) => setS({ ...s, chatGroupCreation: e.target.value as Settings['chatGroupCreation'] })}><option value="everyone">Todos os colaboradores</option><option value="leaders">Somente coordenadores, responsáveis e administração</option></Select>}
        </Field>
        <Field label="Prazo para reabrir chamados encerrados (dias)" hint="0 impede o solicitante de reabrir após o encerramento.">
          {(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} max={90} value={s.ticketReopenWindowDays} onChange={(e) => setS({ ...s, ticketReopenWindowDays: Number(e.target.value) })} className="w-32" />}
        </Field>
        <Field label="Encerrar automaticamente chamados resolvidos após (dias)" hint="0 desativa o encerramento automático.">
          {(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} max={90} value={s.ticketAutoCloseResolvedDays} onChange={(e) => setS({ ...s, ticketAutoCloseResolvedDays: Number(e.target.value) })} className="w-32" />}
        </Field>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
      </Card>
    </AdminPage>
  );
}
