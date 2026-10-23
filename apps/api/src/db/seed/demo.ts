import { OPEN_TICKET_STATUSES, type TicketStatusKey } from '@uon/shared';
import { eq, sql } from 'drizzle-orm';
import { addBusinessMinutes } from '../../modules/tickets/sla.js';
import type { Database } from '../client.js';
import {
  businessCalendars,
  conversationMembers,
  conversations,
  departmentMemberships,
  departments,
  messages,
  notifications,
  slaPolicies,
  teamMemberships,
  teams,
  ticketCategories,
  ticketComments,
  ticketEvents,
  tickets,
  userIdentities,
  userRoles,
  users,
} from '../schema/index.js';
import { seedBase } from './base.js';

export const DEMO_EMAIL_DOMAIN = 'demo.uonconnect.local';

/**
 * Fictitious people used only for demonstrations and automated tests.
 * Every account is flagged `is_demo`; e-mails use a reserved, non-routable domain.
 */
export const DEMO_PEOPLE = {
  founder: { name: 'Helena Prado', title: 'Conta fundadora (demonstração)' },
  supreme: { name: 'Rafael Nunes', title: 'Supreme Admin designado (demonstração)' },
  tiHead: { name: 'Bruno Castro', title: 'Gerente de TI' },
  tiAgent: { name: 'Carla Mendes', title: 'Analista de suporte' },
  rhHead: { name: 'Juliana Rocha', title: 'Gerente de RH' },
  rhAgent: { name: 'Pedro Alves', title: 'Analista de RH' },
  avHead: { name: 'Fernanda Lopes', title: 'Gestora de Avaliações' },
  coordBradesco: { name: 'Diego Martins', title: 'Coordenador — Carteira Bradesco' },
  coordItau: { name: 'Larissa Souza', title: 'Coordenadora — Carteira Itaú' },
  coordSantander: { name: 'Tiago Ribeiro', title: 'Coordenador — Carteira Santander' },
  bradesco1: { name: 'Ana Beatriz Costa', title: 'Avaliadora' },
  bradesco2: { name: 'Lucas Pereira', title: 'Avaliador' },
  itau1: { name: 'Mariana Gomes', title: 'Avaliadora' },
  itau2: { name: 'Gabriel Fernandes', title: 'Avaliador' },
  santander1: { name: 'Beatriz Carvalho', title: 'Avaliadora' },
  santander2: { name: 'Rodrigo Almeida', title: 'Avaliador' },
  forensicHead: { name: 'Sérgio Moura', title: 'Responsável — Forensic' },
  forensic1: { name: 'Camila Duarte', title: 'Analista forense' },
  patrimHead: { name: 'Renata Farias', title: 'Responsável — Patrimoniais' },
  patrim1: { name: 'André Barros', title: 'Analista patrimonial' },
  juridicoHead: { name: 'Eduardo Pires', title: 'Responsável — Jurídico' },
  juridico1: { name: 'Patrícia Nogueira', title: 'Advogada' },
  auditor: { name: 'Vanessa Lima', title: 'Auditoria interna' },
  platformAdmin: { name: 'Otávio Reis', title: 'Administrador da plataforma' },
} as const;
export type DemoKey = keyof typeof DEMO_PEOPLE;

export const demoEmail = (name: string) =>
  `${name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(' ')
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join('.')}@${DEMO_EMAIL_DOMAIN}`;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DemoSeedRefused extends Error {}

export async function seedDemo(db: Database, opts: { tickets?: number; now?: Date } = {}) {
  const realUsers = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.isDemo, false));
  if ((realUsers[0]?.n ?? 0) > 0) {
    throw new DemoSeedRefused('Existem usuários reais neste banco. Dados de demonstração não podem ser misturados com dados corporativos.');
  }
  const existingDemo = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.isDemo, true));
  if ((existingDemo[0]?.n ?? 0) > 0) throw new DemoSeedRefused('Os dados de demonstração já foram criados neste banco.');

  const { companyId, deptIds } = await seedBase(db);
  const now = opts.now ?? new Date();
  const rand = rng(20261023);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;

  return db.transaction(async (tx) => {
    // The demo founder is created through the same guarded path as the real bootstrap.
    await tx.execute(sql`SET LOCAL uon.founder_recovery = 'on'`);
    const ids = {} as Record<DemoKey, string>;
    for (const [key, p] of Object.entries(DEMO_PEOPLE) as [DemoKey, (typeof DEMO_PEOPLE)[DemoKey]][]) {
      const [u] = await tx.insert(users).values({
        companyId,
        email: demoEmail(p.name),
        displayName: p.name,
        jobTitle: p.title,
        phone: key === 'founder' ? null : `+55 11 9${String(1000 + Object.keys(ids).length).padStart(4, '0')}-0000`,
        isDemo: true,
        isFounder: key === 'founder',
      }).returning();
      ids[key] = u!.id;
    }
    await tx.insert(userIdentities).values({ userId: ids.founder, provider: 'dev', subject: ids.founder, emailAtLink: demoEmail(DEMO_PEOPLE.founder.name) });
    await tx.execute(sql`SET LOCAL uon.founder_recovery = 'off'`);

    await tx.insert(userRoles).values([
      { userId: ids.founder, role: 'supreme_admin' },
      { userId: ids.supreme, role: 'supreme_admin', grantedBy: ids.founder },
      { userId: ids.platformAdmin, role: 'platform_admin', grantedBy: ids.founder },
      { userId: ids.tiAgent, role: 'platform_admin', grantedBy: ids.founder },
      { userId: ids.auditor, role: 'auditor', grantedBy: ids.founder },
    ]);

    const teamRows = await tx.select().from(teams);
    const teamByName = (n: string) => teamRows.find((t) => t.name === n)!.id;
    const tBrad = teamByName('Carteira Bradesco');
    const tItau = teamByName('Carteira Itaú');
    const tSant = teamByName('Carteira Santander');
    const extraTeams: Record<string, string> = {};
    for (const [dept, name] of [['FORENSIC', 'Equipe Forensic'], ['PATRIMONIAIS', 'Equipe Patrimoniais'], ['JURÍDICO', 'Equipe Jurídico']] as const) {
      const [t] = await tx.insert(teams).values({ departmentId: deptIds[dept]!, name, description: 'Equipe criada pelo seed de demonstração.' }).returning();
      extraTeams[dept] = t!.id;
    }

    await tx.insert(departmentMemberships).values([
      { userId: ids.tiHead, departmentId: deptIds.TI!, role: 'head' },
      { userId: ids.tiAgent, departmentId: deptIds.TI!, role: 'agent' },
      { userId: ids.supreme, departmentId: deptIds.TI!, role: 'member' },
      { userId: ids.rhHead, departmentId: deptIds.RH!, role: 'head' },
      { userId: ids.rhAgent, departmentId: deptIds.RH!, role: 'agent' },
      { userId: ids.avHead, departmentId: deptIds['AVALIAÇÕES']!, role: 'head' },
      { userId: ids.forensicHead, departmentId: deptIds.FORENSIC!, role: 'head' },
      { userId: ids.patrimHead, departmentId: deptIds.PATRIMONIAIS!, role: 'head' },
      { userId: ids.juridicoHead, departmentId: deptIds['JURÍDICO']!, role: 'head' },
      { userId: ids.auditor, departmentId: deptIds['JURÍDICO']!, role: 'member' },
      { userId: ids.platformAdmin, departmentId: deptIds.TI!, role: 'member' },
    ]);
    await tx.insert(teamMemberships).values([
      { userId: ids.coordBradesco, teamId: tBrad, role: 'coordinator' },
      { userId: ids.bradesco1, teamId: tBrad, role: 'member' },
      { userId: ids.bradesco2, teamId: tBrad, role: 'member' },
      { userId: ids.coordItau, teamId: tItau, role: 'coordinator' },
      { userId: ids.itau1, teamId: tItau, role: 'member' },
      { userId: ids.itau2, teamId: tItau, role: 'member' },
      { userId: ids.coordSantander, teamId: tSant, role: 'coordinator' },
      { userId: ids.santander1, teamId: tSant, role: 'member' },
      { userId: ids.santander2, teamId: tSant, role: 'member' },
      { userId: ids.forensic1, teamId: extraTeams.FORENSIC!, role: 'member' },
      { userId: ids.patrim1, teamId: extraTeams.PATRIMONIAIS!, role: 'member' },
      { userId: ids.juridico1, teamId: extraTeams['JURÍDICO']!, role: 'member' },
    ]);

    // Demonstration SLA policies (clearly named) so the SLA indicators have something to show.
    const [cal] = await tx.select().from(businessCalendars).limit(1);
    const slaDefs = [
      { priorityKey: 'urgent', firstResponseMinutes: 30, resolutionMinutes: 240 },
      { priorityKey: 'high', firstResponseMinutes: 60, resolutionMinutes: 480 },
      { priorityKey: 'medium', firstResponseMinutes: 240, resolutionMinutes: 1440 },
      { priorityKey: 'low', firstResponseMinutes: 480, resolutionMinutes: 2400 },
    ];
    const policies = await tx.insert(slaPolicies).values(slaDefs.map((s) => ({ ...s, name: `SLA ${s.priorityKey} (demonstração)`, calendarId: cal!.id }))).returning();
    const calSpec = { timezone: cal!.timezone, workingHours: cal!.workingHours, holidays: new Set<string>() };

    /* ------------------------------------------------ tickets */
    const cats = await tx.select().from(ticketCategories);
    const deptRows = await tx.select().from(departments);
    const deptOf = (id: string) => deptRows.find((d) => d.id === id)!;
    const people = {
      [tBrad]: { coord: ids.coordBradesco, members: [ids.bradesco1, ids.bradesco2], dept: deptIds['AVALIAÇÕES']!, head: ids.avHead },
      [tItau]: { coord: ids.coordItau, members: [ids.itau1, ids.itau2], dept: deptIds['AVALIAÇÕES']!, head: ids.avHead },
      [tSant]: { coord: ids.coordSantander, members: [ids.santander1, ids.santander2], dept: deptIds['AVALIAÇÕES']!, head: ids.avHead },
      [extraTeams.FORENSIC!]: { coord: null, members: [ids.forensic1], dept: deptIds.FORENSIC!, head: ids.forensicHead },
      [extraTeams.PATRIMONIAIS!]: { coord: null, members: [ids.patrim1], dept: deptIds.PATRIMONIAIS!, head: ids.patrimHead },
      [extraTeams['JURÍDICO']!]: { coord: null, members: [ids.juridico1], dept: deptIds['JURÍDICO']!, head: ids.juridicoHead },
    } as Record<string, { coord: string | null; members: string[]; dept: string; head: string }>;
    const teamWeights = [tBrad, tBrad, tBrad, tItau, tItau, tSant, tSant, tSant, extraTeams.FORENSIC!, extraTeams.PATRIMONIAIS!, extraTeams['JURÍDICO']!];
    const clientOfTeam = new Map(teamRows.map((t) => [t.id, t.clientId]));

    const TITLES: Record<string, string[]> = {
      'Suporte técnico': ['Computador lento ao abrir planilhas', 'Impressora do 3º andar sem conexão', 'Outlook não sincroniza', 'VPN desconectando com frequência'],
      'Acesso e permissões': ['Acesso à pasta compartilhada da carteira', 'Redefinição de senha do sistema de laudos', 'Permissão de leitura no SharePoint'],
      Equipamentos: ['Solicitação de segundo monitor', 'Troca de headset com defeito', 'Notebook para novo colaborador'],
      'Aplicações e sistemas': ['Erro ao gerar relatório de avaliação', 'Sistema de laudos travando ao salvar', 'Dúvida na emissão de relatório mensal'],
      'Solicitação administrativa': ['Atualização de dados cadastrais do cliente', 'Reserva de sala para reunião com cliente'],
      RH: ['Programação de férias', 'Dúvida sobre benefício', 'Solicitação de declaração'],
      'Solicitação ao gestor': ['Ajuste na distribuição de laudos da semana', 'Aprovação de horas extras', 'Prioridade de vistorias pendentes'],
      'Dúvidas operacionais': ['Procedimento para vistoria remota', 'Modelo de relatório atualizado', 'Prazo de entrega para o cliente'],
      Outros: ['Sugestão de melhoria no fluxo', 'Material de apoio para treinamento'],
    };

    const count = opts.tickets ?? 140;
    for (let i = 0; i < count; i++) {
      const team = pick(teamWeights);
      const p = people[team]!;
      const requester = pick([...p.members, ...(p.coord && rand() < 0.15 ? [p.coord] : [])]);
      const cat = pick(cats);
      let destination: 'team' | 'department_head' | 'service_desk';
      let handlingDepartmentId: string;
      let handlingTeamId: string | null = null;
      let assigneePool: string[];
      if (cat.serviceDepartmentId) {
        destination = 'service_desk';
        handlingDepartmentId = cat.serviceDepartmentId;
        assigneePool = handlingDepartmentId === deptIds.TI ? [ids.tiAgent, ids.tiAgent, ids.tiHead] : [ids.rhAgent, ids.rhHead];
      } else if (p.coord && rand() < 0.7) {
        destination = 'team';
        handlingTeamId = team;
        handlingDepartmentId = p.dept;
        assigneePool = [p.coord, ...p.members.filter((m) => m !== requester)];
      } else {
        destination = 'department_head';
        handlingDepartmentId = p.dept;
        assigneePool = [p.head];
      }
      const ageDays = Math.pow(rand(), 1.4) * 150;
      const createdAt = new Date(now.getTime() - ageDays * 86_400_000 - rand() * 8 * 3_600_000);
      const priority = pick(['low', 'medium', 'medium', 'medium', 'high', 'high', 'urgent'] as const);
      let status: TicketStatusKey;
      const r = rand();
      if (ageDays > 20) status = r < 0.75 ? 'closed' : r < 0.9 ? 'resolved' : r < 0.95 ? 'cancelled' : 'in_progress';
      else if (ageDays > 5) status = r < 0.35 ? 'closed' : r < 0.6 ? 'resolved' : r < 0.75 ? 'in_progress' : r < 0.85 ? 'waiting_requester' : r < 0.92 ? 'waiting_third_party' : 'triage';
      else status = r < 0.3 ? 'open' : r < 0.5 ? 'triage' : r < 0.75 ? 'in_progress' : r < 0.85 ? 'waiting_requester' : 'resolved';
      if (status === 'resolved' && ageDays > 6) status = 'closed';

      const assigneeId = status === 'open' ? null : pick(assigneePool);
      const policy = policies.find((x) => x.priorityKey === priority)!;
      const firstResponseDueAt = addBusinessMinutes(createdAt, policy.firstResponseMinutes, calSpec);
      const resolutionDueAt = addBusinessMinutes(createdAt, policy.resolutionMinutes, calSpec);
      const firstRespondedAt = status === 'open' ? null : new Date(createdAt.getTime() + (0.2 + rand() * 6) * 3_600_000);
      const resolutionHours = (priority === 'urgent' ? 2 : priority === 'high' ? 6 : 20) * (0.4 + rand() * 2.2);
      let resolvedAt = ['resolved', 'closed'].includes(status) ? new Date(createdAt.getTime() + resolutionHours * 3_600_000) : null;
      if (resolvedAt && resolvedAt > now) resolvedAt = new Date(now.getTime() - 3_600_000);
      const closedAt = status === 'closed' && resolvedAt ? new Date(Math.min(now.getTime(), resolvedAt.getTime() + 2 * 86_400_000)) : null;
      const cancelledAt = status === 'cancelled' ? new Date(createdAt.getTime() + 86_400_000) : null;
      const updatedAt = closedAt ?? cancelledAt ?? resolvedAt ?? firstRespondedAt ?? createdAt;

      const seq = await tx.execute(sql`SELECT nextval(pg_get_serial_sequence('tickets', 'number'))::bigint AS n`);
      const number = Number((seq.rows[0] as { n: string }).n);
      const title = pick(TITLES[cat.name] ?? TITLES.Outros!);
      const [t] = await tx.insert(tickets).values({
        number,
        protocol: `UON-${createdAt.getUTCFullYear()}-${String(number).padStart(6, '0')}`,
        title,
        description: `${title}. (Chamado fictício gerado para demonstração.)`,
        requesterId: requester,
        requesterDepartmentId: p.dept,
        requesterTeamId: team,
        clientId: clientOfTeam.get(team) ?? null,
        categoryId: cat.id,
        priorityKey: priority,
        statusKey: status,
        destination,
        handlingDepartmentId,
        handlingTeamId,
        assigneeId,
        confidential: cat.defaultConfidential,
        slaPolicyId: policy.id,
        firstResponseDueAt,
        resolutionDueAt,
        firstRespondedAt,
        resolvedAt,
        closedAt,
        cancelledAt,
        createdAt,
        updatedAt,
      }).returning();
      const tid = t!.id;
      const events: (typeof ticketEvents.$inferInsert)[] = [{ ticketId: tid, actorId: requester, type: 'created', toValue: 'open', createdAt }];
      if (assigneeId) events.push({ ticketId: tid, actorId: assigneeId, type: 'assigned', toValue: assigneeId, createdAt: firstRespondedAt! });
      if (status !== 'open') events.push({ ticketId: tid, actorId: assigneeId, type: 'status_changed', fromValue: 'open', toValue: OPEN_TICKET_STATUSES.includes(status) ? status : 'in_progress', createdAt: firstRespondedAt! });
      if (resolvedAt) events.push({ ticketId: tid, actorId: assigneeId, type: 'status_changed', fromValue: 'in_progress', toValue: 'resolved', createdAt: resolvedAt });
      if (closedAt) events.push({ ticketId: tid, actorId: requester, type: 'status_changed', fromValue: 'resolved', toValue: 'closed', createdAt: closedAt });
      if (cancelledAt) events.push({ ticketId: tid, actorId: requester, type: 'status_changed', fromValue: 'open', toValue: 'cancelled', createdAt: cancelledAt });
      await tx.insert(ticketEvents).values(events);
      if (assigneeId && firstRespondedAt) {
        await tx.insert(ticketComments).values({ ticketId: tid, authorId: assigneeId, body: 'Recebido. Estou verificando e retorno em breve.', createdAt: firstRespondedAt });
        if (status === 'waiting_requester') {
          await tx.insert(ticketComments).values({ ticketId: tid, authorId: assigneeId, body: 'Pode me enviar mais detalhes (prints ou o número do processo)?', createdAt: new Date(firstRespondedAt.getTime() + 3_600_000) });
        }
        if (resolvedAt) await tx.insert(ticketComments).values({ ticketId: tid, authorId: assigneeId, body: 'Solicitação atendida. Por favor, confirme se está tudo certo.', createdAt: resolvedAt });
      }
    }

    /* ------------------------------------------------ conversations */
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    async function conv(type: 'direct' | 'group', members: string[], opts: { name?: string; teamId?: string; admin?: string; description?: string }, msgs: [string, string, number][]) {
      const [c] = await tx.insert(conversations).values({
        type,
        name: opts.name ?? null,
        description: opts.description ?? null,
        createdBy: members[0]!,
        teamId: opts.teamId ?? null,
        directKey: type === 'direct' ? [...members].sort().join(':') : null,
        createdAt: minutesAgo(60 * 24 * 10),
        lastMessageAt: msgs.length ? minutesAgo(msgs[msgs.length - 1]![2]) : null,
      }).returning();
      await tx.insert(conversationMembers).values(members.map((u) => ({
        conversationId: c!.id,
        userId: u,
        role: u === (opts.admin ?? members[0]) && type === 'group' ? ('admin' as const) : ('member' as const),
        joinedAt: minutesAgo(60 * 24 * 10),
        lastReadAt: minutesAgo(msgs.length > 1 ? msgs[msgs.length - 2]![2] : 60 * 24 * 10),
      })));
      if (msgs.length) await tx.insert(messages).values(msgs.map(([sender, body, ago]) => ({ conversationId: c!.id, senderId: sender, body, createdAt: minutesAgo(ago) })));
      return c!.id;
    }
    await conv('direct', [ids.bradesco1, ids.coordBradesco], {}, [
      [ids.bradesco1, 'Diego, bom dia! Consegue revisar o laudo do imóvel da Rua das Flores hoje?', 180],
      [ids.coordBradesco, 'Bom dia, Ana! Consigo sim, depois das 14h.', 170],
      [ids.bradesco1, 'Perfeito, obrigada!', 165],
    ]);
    await conv('group', [ids.coordBradesco, ids.bradesco1, ids.bradesco2], { name: 'Carteira Bradesco', teamId: tBrad, description: 'Grupo oficial da equipe (sincronizado com a equipe).' }, [
      [ids.coordBradesco, 'Pessoal, a distribuição de vistorias desta semana já está no sistema.', 300],
      [ids.bradesco2, 'Vi aqui, obrigado. Vou começar pelas de prioridade alta.', 290],
      [ids.bradesco1, 'Combinado! 👍', 285],
    ]);
    await conv('group', [ids.coordItau, ids.itau1, ids.itau2], { name: 'Carteira Itaú', teamId: tItau, description: 'Grupo oficial da equipe.' }, [
      [ids.coordItau, 'Lembrete: reunião de alinhamento amanhã às 10h.', 600],
    ]);
    await conv('group', [ids.coordSantander, ids.santander1, ids.santander2], { name: 'Carteira Santander', teamId: tSant, description: 'Grupo oficial da equipe.' }, []);
    await conv('group', [ids.tiHead, ids.tiAgent], { name: 'TI — Plantão', description: 'Coordenação do atendimento técnico.' }, [
      [ids.tiHead, 'Carla, a fila está tranquila hoje. Pode priorizar as solicitações de acesso.', 120],
      [ids.tiAgent, 'Certo, Bruno.', 110],
    ]);
    await conv('group', [ids.avHead, ids.coordBradesco, ids.coordItau, ids.coordSantander], { name: 'Coordenação de Avaliações', description: 'Gestão das carteiras.' }, [
      [ids.avHead, 'Vamos consolidar os indicadores do mês na sexta-feira.', 1440],
      [ids.coordSantander, 'Ok, envio os números da Santander até quinta.', 1400],
    ]);

    await tx.insert(notifications).values([
      { userId: ids.bradesco1, category: 'message', title: 'Nova mensagem de Diego Martins', body: 'Bom dia, Ana! Consigo sim, depois das 14h.', link: '/conversas', createdAt: minutesAgo(170), updatedAt: minutesAgo(170) },
      { userId: ids.tiAgent, category: 'ticket_assigned', title: 'Você tem chamados atribuídos na fila de TI', link: '/chamados?view=assigned', createdAt: minutesAgo(90), updatedAt: minutesAgo(90) },
    ]);

    return { ids, deptIds, teams: { tBrad, tItau, tSant, ...extraTeams }, deptName: (id: string) => deptOf(id).name };
  });
}
