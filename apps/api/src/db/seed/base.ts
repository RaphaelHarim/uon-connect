import { DEFAULT_TICKET_STATUS_LABELS, TICKET_STATUS_KIND_OF, type TicketStatusKey } from '@uon/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  businessCalendars,
  clients,
  companies,
  departments,
  teams,
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
  ticketStatusTransitions,
} from '../schema/index.js';

/**
 * Initial organisational configuration (no people, no tickets). Idempotent: running it again
 * creates only what is missing and never overwrites changes made in the admin panel.
 */
export async function seedBase(db: Database) {
  return db.transaction(async (tx) => {
    let [company] = await tx.select().from(companies).limit(1);
    if (!company) [company] = await tx.insert(companies).values({ name: 'UON Consulting' }).returning();
    const companyId = company!.id;

    const DEPARTMENTS: { name: string; acceptsTickets: boolean; description: string }[] = [
      { name: 'AVALIAÇÕES', acceptsTickets: false, description: 'Avaliações — carteiras de clientes.' },
      { name: 'FORENSIC', acceptsTickets: false, description: 'Forensic.' },
      { name: 'PATRIMONIAIS', acceptsTickets: false, description: 'Patrimoniais.' },
      { name: 'JURÍDICO', acceptsTickets: false, description: 'Jurídico.' },
      { name: 'TI', acceptsTickets: true, description: 'Tecnologia da informação — central de atendimento técnico.' },
      { name: 'RH', acceptsTickets: true, description: 'Recursos humanos — processos administrativos de pessoal.' },
    ];
    const deptIds: Record<string, string> = {};
    for (const d of DEPARTMENTS) {
      const [existing] = await tx.select().from(departments).where(and(eq(departments.companyId, companyId), sql`lower(${departments.name}) = lower(${d.name})`));
      deptIds[d.name] = existing?.id ?? (await tx.insert(departments).values({ ...d, companyId }).returning())[0]!.id;
    }

    const clientIds: Record<string, string> = {};
    for (const name of ['Bradesco', 'Itaú', 'Santander']) {
      const [existing] = await tx.select().from(clients).where(and(eq(clients.companyId, companyId), sql`lower(${clients.name}) = lower(${name})`));
      clientIds[name] = existing?.id ?? (await tx.insert(clients).values({ companyId, name }).returning())[0]!.id;
    }

    // AVALIAÇÕES works in three client portfolios ("carteiras").
    for (const client of ['Bradesco', 'Itaú', 'Santander']) {
      const name = `Carteira ${client}`;
      const [existing] = await tx.select().from(teams).where(and(eq(teams.departmentId, deptIds['AVALIAÇÕES']!), sql`lower(${teams.name}) = lower(${name})`));
      if (!existing) await tx.insert(teams).values({ departmentId: deptIds['AVALIAÇÕES']!, clientId: clientIds[client]!, name, description: `Carteira de clientes ${client}.` });
    }

    const PRIORITIES = [
      { key: 'low', label: 'Baixa', rank: 1, color: '#64748b' },
      { key: 'medium', label: 'Média', rank: 2, color: '#2563eb' },
      { key: 'high', label: 'Alta', rank: 3, color: '#d97706' },
      { key: 'urgent', label: 'Urgente', rank: 4, color: '#b91c1c' },
    ];
    await tx.insert(ticketPriorities).values(PRIORITIES).onConflictDoNothing();

    const STATUS_COLORS: Record<TicketStatusKey, string> = {
      open: '#2563eb',
      triage: '#7c3aed',
      in_progress: '#0891b2',
      waiting_requester: '#d97706',
      waiting_third_party: '#a16207',
      resolved: '#16a34a',
      closed: '#475569',
      cancelled: '#9ca3af',
    };
    const keys = Object.keys(DEFAULT_TICKET_STATUS_LABELS) as TicketStatusKey[];
    await tx.insert(ticketStatuses).values(keys.map((key, i) => ({
      key,
      label: DEFAULT_TICKET_STATUS_LABELS[key],
      kind: TICKET_STATUS_KIND_OF[key],
      color: STATUS_COLORS[key],
      sortOrder: (i + 1) * 10,
    }))).onConflictDoNothing();

    const H = 'handler' as const;
    const R = 'requester' as const;
    const active: TicketStatusKey[] = ['open', 'triage', 'in_progress', 'waiting_requester', 'waiting_third_party'];
    const transitions: { fromStatus: TicketStatusKey; toStatus: TicketStatusKey; actor: 'handler' | 'requester'; requiresReason?: boolean }[] = [
      { fromStatus: 'open', toStatus: 'triage', actor: H },
      { fromStatus: 'open', toStatus: 'in_progress', actor: H },
      { fromStatus: 'triage', toStatus: 'in_progress', actor: H },
      { fromStatus: 'triage', toStatus: 'waiting_requester', actor: H },
      { fromStatus: 'in_progress', toStatus: 'waiting_requester', actor: H },
      { fromStatus: 'in_progress', toStatus: 'waiting_third_party', actor: H },
      { fromStatus: 'waiting_requester', toStatus: 'in_progress', actor: H },
      { fromStatus: 'waiting_third_party', toStatus: 'in_progress', actor: H },
      { fromStatus: 'triage', toStatus: 'resolved', actor: H },
      { fromStatus: 'in_progress', toStatus: 'resolved', actor: H },
      { fromStatus: 'waiting_requester', toStatus: 'resolved', actor: H },
      { fromStatus: 'waiting_third_party', toStatus: 'resolved', actor: H },
      { fromStatus: 'resolved', toStatus: 'closed', actor: H },
      { fromStatus: 'resolved', toStatus: 'in_progress', actor: H, requiresReason: true },
      { fromStatus: 'resolved', toStatus: 'closed', actor: R },
      { fromStatus: 'resolved', toStatus: 'in_progress', actor: R, requiresReason: true },
      { fromStatus: 'closed', toStatus: 'in_progress', actor: R, requiresReason: true },
      { fromStatus: 'closed', toStatus: 'in_progress', actor: H, requiresReason: true },
      ...active.map((s) => ({ fromStatus: s, toStatus: 'cancelled' as const, actor: H, requiresReason: true })),
      ...active.map((s) => ({ fromStatus: s, toStatus: 'cancelled' as const, actor: R, requiresReason: true })),
    ];
    await tx.insert(ticketStatusTransitions).values(transitions.map((t) => ({ requiresReason: false, ...t }))).onConflictDoNothing();

    const existingCats = await tx.select({ name: ticketCategories.name }).from(ticketCategories);
    const have = new Set(existingCats.map((c) => c.name.toLowerCase()));
    const CATEGORIES = [
      { name: 'Suporte técnico', serviceDepartmentId: deptIds.TI, description: 'Problemas com computador, rede, impressora ou e-mail.' },
      { name: 'Acesso e permissões', serviceDepartmentId: deptIds.TI, description: 'Criação de acessos, senhas e permissões em sistemas.' },
      { name: 'Equipamentos', serviceDepartmentId: deptIds.TI, description: 'Solicitação ou troca de equipamentos.' },
      { name: 'Aplicações e sistemas', serviceDepartmentId: deptIds.TI, description: 'Erros ou dúvidas em sistemas corporativos.' },
      { name: 'Solicitação administrativa', serviceDepartmentId: null, description: 'Pedidos administrativos ao gestor ou departamento.' },
      { name: 'RH', serviceDepartmentId: deptIds.RH, description: 'Férias, benefícios, documentos e demais processos de pessoal.', defaultConfidential: true },
      { name: 'Solicitação ao gestor', serviceDepartmentId: null, description: 'Pedidos direcionados à coordenação ou ao responsável.' },
      { name: 'Dúvidas operacionais', serviceDepartmentId: null, description: 'Dúvidas sobre processos da área.' },
      { name: 'Outros', serviceDepartmentId: null, description: 'Demandas que não se encaixam nas demais categorias.' },
    ];
    let order = 10;
    for (const c of CATEGORIES) {
      if (!have.has(c.name.toLowerCase())) await tx.insert(ticketCategories).values({ ...c, sortOrder: order });
      order += 10;
    }

    const [cal] = await tx.select().from(businessCalendars).limit(1);
    if (!cal) {
      const day: [string, string][] = [['09:00', '12:00'], ['13:00', '18:00']];
      await tx.insert(businessCalendars).values({
        name: 'Horário comercial — São Paulo',
        timezone: 'America/Sao_Paulo',
        workingHours: { '1': day, '2': day, '3': day, '4': day, '5': day },
      });
    }
    return { companyId, deptIds, clientIds };
  });
}
