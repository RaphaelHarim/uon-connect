import type { UserSummary } from '@uon/shared/browser';
import { useQuery } from '@tanstack/react-query';
import { Building2, Headset, Users } from 'lucide-react';
import { Link } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar, Badge, Card, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { get } from '@/lib/api';

export interface OrgStructure {
  company: { id: string; name: string };
  clients: { id: string; name: string; active: boolean }[];
  departments: {
    id: string;
    name: string;
    description: string | null;
    acceptsTickets: boolean;
    active: boolean;
    heads: UserSummary[];
    teams: { id: string; name: string; description: string | null; clientId: string | null; clientName: string | null; active: boolean; coordinators: UserSummary[]; memberCount: number; departmentId: string }[];
  }[];
}

function People({ people, empty }: { people: UserSummary[]; empty: string }) {
  if (!people.length) return <span className="text-[13px] text-fg-3 italic">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-2">
      {people.map((p) => (
        <Link key={p.id} to={`/pessoas/${p.id}`} className="flex items-center gap-1.5 text-[13px] hover:underline">
          <Avatar name={p.displayName} src={p.avatarUrl} size={22} /> {p.displayName}
        </Link>
      ))}
    </span>
  );
}

export default function OrgPage() {
  const q = useQuery({ queryKey: ['org'], queryFn: () => get<OrgStructure>('/org/structure') });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner />;
  return (
    <PageContainer wide>
      <PageHeader title={q.data.company.name} description="Departamentos, equipes, carteiras de clientes e responsáveis." />
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data.departments.filter((d) => d.active).map((d) => (
          <Card key={d.id} className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand-text"><Building2 className="size-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-wide">{d.name}</h2>
                  {d.acceptsTickets && <Badge tone="info" icon={<Headset className="size-3" />}>Central de atendimento</Badge>}
                </div>
                {d.description && <p className="text-[13px] text-fg-3">{d.description}</p>}
              </div>
            </div>
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium text-fg-3">Responsável</p>
              <People people={d.heads} empty="Configuração pendente" />
            </div>
            {d.teams.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-4">
                {d.teams.filter((t) => t.active).map((t) => (
                  <li key={t.id} className="rounded-lg bg-surface-2 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Users className="size-3.5 text-fg-3" aria-hidden />
                      <span className="text-sm font-medium">{t.name}</span>
                      {t.clientName && <Badge tone="brand">Carteira {t.clientName}</Badge>}
                      <span className="ml-auto text-xs text-fg-3">{t.memberCount} pessoas</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2"><span className="text-xs text-fg-3">Coordenação:</span><People people={t.coordinators} empty="pendente" /></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
