import type { Permission } from '@uon/shared/browser';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { EmptyState, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** UI convenience only — every admin endpoint enforces its permission on the server. */
export function AdminPage({ permission, title, description, actions, children }: { permission: Permission | Permission[]; title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  const { can } = useAuth();
  const perms = Array.isArray(permission) ? permission : [permission];
  return (
    <PageContainer wide>
      <PageHeader breadcrumbs={<Link to="/admin" className="hover:underline">Administração</Link>} title={title} description={description} actions={perms.some(can) ? actions : undefined} />
      {perms.some(can) ? children : <EmptyState icon={<ShieldAlert className="size-5" />} title="Acesso restrito" description="Você não tem permissão para esta área administrativa." />}
    </PageContainer>
  );
}

export const ROLE_LABELS: Record<string, string> = { supreme_admin: 'Supreme Admin', platform_admin: 'Administrador da plataforma', auditor: 'Auditor' };
