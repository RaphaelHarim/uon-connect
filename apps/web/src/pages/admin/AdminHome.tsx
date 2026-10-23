import { Building2, FileClock, Plug, Settings, Ticket, Users } from 'lucide-react';
import { Link } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { Permission } from '@uon/shared/browser';

const SECTIONS: { to: string; title: string; description: string; icon: typeof Users; permission: Permission }[] = [
  { to: '/admin/usuarios', title: 'Usuários e permissões', description: 'Contas, status, funções, vínculos e acesso efetivo.', icon: Users, permission: 'users.manage' },
  { to: '/admin/organizacao', title: 'Estrutura organizacional', description: 'Departamentos, equipes e carteiras de clientes.', icon: Building2, permission: 'org.manage' },
  { to: '/admin/chamados', title: 'Configuração de chamados', description: 'Categorias, prioridades, status, transições, calendário e SLA.', icon: Ticket, permission: 'tickets.config.manage' },
  { to: '/admin/auditoria', title: 'Auditoria', description: 'Registro imutável de operações relevantes e verificação de integridade.', icon: FileClock, permission: 'audit.read' },
  { to: '/admin/integracoes', title: 'Integrações', description: 'Microsoft 365, e-mail, armazenamento e TURN — estado real de cada uma.', icon: Plug, permission: 'integrations.read' },
  { to: '/admin/configuracoes', title: 'Políticas da plataforma', description: 'Regras de conversas, reabertura e encerramento automático.', icon: Settings, permission: 'settings.manage' },
];

export default function AdminHome() {
  const { can } = useAuth();
  const visible = SECTIONS.filter((s) => can(s.permission));
  return (
    <PageContainer>
      <PageHeader title="Administração" description="A administração técnica não concede acesso ao conteúdo de chamados, conversas ou arquivos." />
      {visible.length === 0 ? <EmptyState title="Acesso restrito" /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => (
            <Link key={s.to} to={s.to}>
              <Card className="h-full p-5 transition-colors hover:border-line-strong">
                <s.icon className="mb-3 size-5 text-brand" aria-hidden />
                <p className="font-semibold">{s.title}</p>
                <p className="mt-1 text-[13px] text-fg-3">{s.description}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {can('admin.dashboard') && <p className="mt-6 text-[13px] text-fg-3">Indicadores da plataforma: <Link to="/?visao=admin" className="font-medium text-brand-text hover:underline">Painel → Plataforma</Link>.</p>}
    </PageContainer>
  );
}
