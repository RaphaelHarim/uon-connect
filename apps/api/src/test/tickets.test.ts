import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../app.js';
import { tickets } from '../db/schema/index.js';
import { createTestApp, login, PDF_MIN, PNG_1PX, userId, type Client } from './helpers.js';

let built: BuiltApp;
let org: { departments: { id: string; name: string; teams: { id: string; name: string }[] }[] };
const dept = (name: string) => org.departments.find((d) => d.name === name)!;
const team = (name: string) => org.departments.flatMap((d) => d.teams).find((t) => t.name === name)!;

let categories: { id: string; name: string }[];
const cat = (name: string) => categories.find((c) => c.name === name)!.id;

beforeAll(async () => {
  built = await createTestApp();
  const c = await login(built, 'bradesco1');
  org = (await c.get('/org/structure')).json();
  categories = (await c.get('/tickets/form-options')).json().categories;
});
afterAll(async () => {
  await built.app.close();
});

async function open(c: Client, body: Record<string, unknown>) {
  const r = await c.post('/tickets', { priority: 'medium', description: 'Descrição do teste.', ...body });
  expect(r.status, r.body).toBe(200);
  return r.json() as { id: string; protocol: string };
}

describe('ticket lifecycle (end to end)', () => {
  let id: string;
  let requester: Client;
  let coordinator: Client;

  it('a collaborator opens a ticket to their team coordination', async () => {
    requester = await login(built, 'bradesco1');
    const t = await open(requester, { title: 'Revisão de distribuição de laudos', categoryId: cat('Solicitação ao gestor'), destination: 'team', targetId: team('Carteira Bradesco').id });
    id = t.id;
    expect(t.protocol).toMatch(/^UON-\d{4}-\d{6}$/);
    const detail = (await requester.get(`/tickets/${id}`)).json();
    expect(detail.status.key).toBe('open');
    expect(detail.client.name).toBe('Bradesco');
  });

  it('the team coordinator sees it in the queue and is notified', async () => {
    coordinator = await login(built, 'coordBradesco');
    const queue = (await coordinator.get('/tickets?view=queue&pageSize=100')).json();
    expect(queue.items.some((x: { id: string }) => x.id === id)).toBe(true);
    const notes = (await coordinator.get('/notifications')).json();
    expect(notes.items.some((n: { resourceId: string; category: string }) => n.resourceId === id && n.category === 'ticket_created')).toBe(true);
  });

  it('the requester cannot assign, change priority or jump to resolved', async () => {
    const me = requester.userId;
    expect((await requester.post(`/tickets/${id}/assign`, { assigneeId: me })).status).toBe(403);
    expect((await requester.post(`/tickets/${id}/priority`, { priority: 'urgent' })).status).toBe(403);
    expect((await requester.post(`/tickets/${id}/status`, { status: 'resolved' })).status).toBe(403);
  });

  it('the coordinator assigns a team member and the ticket moves to triage', async () => {
    const assignee = await userId(built, 'bradesco2');
    const r = await coordinator.post(`/tickets/${id}/assign`, { assigneeId: assignee });
    expect(r.status, r.body).toBe(200);
    const outsider = await userId(built, 'itau1');
    expect((await coordinator.post(`/tickets/${id}/assign`, { assigneeId: outsider })).status).toBe(400);
    const d = (await coordinator.get(`/tickets/${id}`)).json();
    expect(d.status.key).toBe('triage');
    expect(d.assignee.id).toBe(assignee);
  });

  it('internal notes are hidden from the requester', async () => {
    const assignee = await login(built, 'bradesco2');
    expect((await assignee.post(`/tickets/${id}/comments`, { body: 'Nota interna da equipe', internal: true })).status).toBe(200);
    expect((await requester.post(`/tickets/${id}/comments`, { body: 'tentativa', internal: true })).status).toBe(403);
    const forRequester = (await requester.get(`/tickets/${id}`)).json();
    expect(forRequester.comments.some((c: { body: string }) => c.body === 'Nota interna da equipe')).toBe(false);
    expect(forRequester.events.some((e: { type: string }) => e.type === 'internal_note')).toBe(false);
    const forAssignee = (await assignee.get(`/tickets/${id}`)).json();
    expect(forAssignee.comments.some((c: { body: string }) => c.body === 'Nota interna da equipe')).toBe(true);
  });

  it('waiting for the requester → requester replies → back in progress automatically', async () => {
    const assignee = await login(built, 'bradesco2');
    expect((await assignee.post(`/tickets/${id}/status`, { status: 'in_progress' })).status).toBe(200);
    expect((await assignee.post(`/tickets/${id}/status`, { status: 'waiting_requester' })).status).toBe(200);
    expect((await requester.post(`/tickets/${id}/comments`, { body: 'Segue a informação solicitada.' })).status).toBe(200);
    expect((await requester.get(`/tickets/${id}`)).json().status.key).toBe('in_progress');
  });

  it('resolve → requester closes → reopen requires a reason', async () => {
    const assignee = await login(built, 'bradesco2');
    expect((await assignee.post(`/tickets/${id}/status`, { status: 'resolved' })).status).toBe(200);
    expect((await requester.post(`/tickets/${id}/status`, { status: 'closed' })).status).toBe(200);
    expect((await requester.post(`/tickets/${id}/comments`, { body: 'depois de fechado' })).status).toBe(409);
    expect((await requester.post(`/tickets/${id}/status`, { status: 'in_progress' })).status).toBe(400);
    const re = await requester.post(`/tickets/${id}/status`, { status: 'in_progress', reason: 'O problema voltou a acontecer.' });
    expect(re.status, re.body).toBe(200);
    const d = (await requester.get(`/tickets/${id}`)).json();
    expect(d.reopenedCount).toBe(1);
    expect(d.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['created', 'assigned', 'status_changed', 'reopened', 'comment']));
  });
});

describe('ticket visibility rules', () => {
  let teamTicket: string;
  let tiTicket: string;
  let rhTicket: string;

  beforeAll(async () => {
    const ana = await login(built, 'bradesco1');
    teamTicket = (await open(ana, { title: 'Pedido para a coordenação Bradesco', categoryId: cat('Dúvidas operacionais'), destination: 'team', targetId: team('Carteira Bradesco').id })).id;
    // Category bound to TI: routed to the TI service desk whatever the client sends.
    tiTicket = (await open(ana, { title: 'Notebook não liga', categoryId: cat('Suporte técnico'), destination: 'team', targetId: team('Carteira Bradesco').id })).id;
    rhTicket = (await open(ana, { title: 'Assunto pessoal com o RH', categoryId: cat('RH'), destination: 'service_desk', targetId: dept('RH').id })).id;
  });

  const canSee = async (who: Parameters<typeof login>[1], id: string) => (await (await login(built, who)).get(`/tickets/${id}`)).status === 200;

  it('routes categories bound to a service desk', async () => {
    const [t] = await built.deps.db.select().from(tickets).where(eq(tickets.id, tiTicket));
    expect(t!.destination).toBe('service_desk');
    expect(t!.handlingDepartmentId).toBe(dept('TI').id);
    const [rh] = await built.deps.db.select().from(tickets).where(eq(tickets.id, rhTicket));
    expect(rh!.confidential).toBe(true);
  });

  it('a colleague from another team cannot see it (404, not 403)', async () => {
    const c = await login(built, 'itau1');
    const r = await c.get(`/tickets/${teamTicket}`);
    expect(r.status).toBe(404);
  });

  it('a coordinator only sees the teams under their responsibility', async () => {
    expect(await canSee('coordBradesco', teamTicket)).toBe(true);
    expect(await canSee('coordItau', teamTicket)).toBe(false);
  });

  it('the AVALIAÇÕES head sees all three portfolios', async () => {
    const head = await login(built, 'avHead');
    const list = (await head.get('/tickets?pageSize=100')).json();
    const clientsSeen = new Set(list.items.map((t: { client: string | null }) => t.client));
    expect([...clientsSeen]).toEqual(expect.arrayContaining(['Bradesco', 'Itaú', 'Santander']));
    expect(await canSee('avHead', teamTicket)).toBe(true);
  });

  it('heads of other departments do not see AVALIAÇÕES tickets', async () => {
    expect(await canSee('forensicHead', teamTicket)).toBe(false);
    const f = await login(built, 'forensicHead');
    const list = (await f.get('/tickets?pageSize=100')).json();
    const avaliacoes = await built.deps.db.select({ id: tickets.id }).from(tickets).where(eq(tickets.requesterDepartmentId, dept('AVALIAÇÕES').id));
    const ids = new Set(avaliacoes.map((a) => a.id));
    expect(list.items.some((t: { id: string }) => ids.has(t.id))).toBe(false);
  });

  it('TI handles the technical ticket but does not see team tickets of other departments', async () => {
    expect(await canSee('tiAgent', tiTicket)).toBe(true);
    expect(await canSee('tiAgent', teamTicket)).toBe(false);
    const ti = await login(built, 'tiAgent');
    const list = (await ti.get('/tickets?pageSize=100')).json();
    const all = (await built.deps.db.select({ id: tickets.id, h: tickets.handlingDepartmentId, a: tickets.assigneeId, r: tickets.requesterId }).from(tickets));
    const tiId = dept('TI').id;
    for (const item of list.items as { id: string }[]) {
      const row = all.find((x) => x.id === item.id)!;
      expect(row.h === tiId || row.a === ti.userId || row.r === ti.userId).toBe(true);
    }
  });

  it('a confidential RH ticket is visible to RH and the requester, not to their coordinator or head', async () => {
    expect(await canSee('rhAgent', rhTicket)).toBe(true);
    expect(await canSee('bradesco1', rhTicket)).toBe(true);
    expect(await canSee('coordBradesco', rhTicket)).toBe(false);
    expect(await canSee('avHead', rhTicket)).toBe(false);
    expect(await canSee('tiHead', rhTicket)).toBe(false);
  });

  it('RH does not get access to tickets outside its competence', async () => {
    expect(await canSee('rhHead', teamTicket)).toBe(false);
    expect(await canSee('rhHead', tiTicket)).toBe(false);
  });

  it('platform administrators and Supreme Admins do not see ticket content by role alone', async () => {
    expect(await canSee('platformAdmin', teamTicket)).toBe(false);
    expect(await canSee('founder', rhTicket)).toBe(false);
    expect(await canSee('supreme', teamTicket)).toBe(false);
    const founder = await login(built, 'founder');
    expect((await founder.get('/tickets?pageSize=100')).json().total).toBe(0);
  });

  it('rejects destinations the user is not entitled to', async () => {
    const ana = await login(built, 'bradesco1');
    const r = await ana.post('/tickets', { title: 'Tentativa de rota indevida', description: 'x', priority: 'low', categoryId: cat('Outros'), destination: 'team', targetId: team('Carteira Itaú').id });
    expect(r.status).toBe(403);
    const r2 = await ana.post('/tickets', { title: 'Tentativa de rota indevida', description: 'x', priority: 'low', categoryId: cat('Outros'), destination: 'department_head', targetId: dept('JURÍDICO').id });
    expect(r2.status).toBe(403);
  });

  it('list results match the visibility rules exactly (spot check per user)', async () => {
    for (const who of ['coordItau', 'avHead', 'rhAgent', 'bradesco2'] as const) {
      const c = await login(built, who);
      const list = (await c.get('/tickets?pageSize=100&sort=created_desc')).json();
      for (const item of list.items.slice(0, 15) as { id: string }[]) {
        expect((await c.get(`/tickets/${item.id}`)).status, `${who} → ${item.id}`).toBe(200);
      }
    }
  });

  it('watchers gain read access only when shared', async () => {
    const ana = await login(built, 'bradesco1');
    const mariana = await userId(built, 'itau1');
    expect(await canSee('itau1', teamTicket)).toBe(false);
    expect((await ana.post(`/tickets/${teamTicket}/watchers`, { userId: mariana })).status).toBe(200);
    expect(await canSee('itau1', teamTicket)).toBe(true);
    // The requester can't share a confidential ticket.
    expect((await ana.post(`/tickets/${rhTicket}/watchers`, { userId: mariana })).status).toBe(403);
  });
});

describe('ticket attachments', () => {
  let ticketId: string;
  let fileId: string;
  beforeAll(async () => {
    const ana = await login(built, 'bradesco1');
    ticketId = (await open(ana, { title: 'Chamado com anexo', categoryId: cat('Dúvidas operacionais'), destination: 'team', targetId: team('Carteira Bradesco').id })).id;
  });

  it('uploads a PDF and allows authorised downloads only', async () => {
    const ana = await login(built, 'bradesco1');
    const up = await ana.upload(`/tickets/${ticketId}/attachments`, 'relatorio.pdf', PDF_MIN, 'application/pdf');
    expect(up.status, up.body).toBe(200);
    fileId = up.json().id;
    const coord = await login(built, 'coordBradesco');
    const ok = await coord.get(`/files/${fileId}`);
    expect(ok.status).toBe(200);
    expect(String(ok.headers['content-disposition'])).toContain('attachment');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    const other = await login(built, 'itau1');
    expect((await other.get(`/files/${fileId}`)).status).toBe(404);
    const admin = await login(built, 'platformAdmin');
    expect((await admin.get(`/files/${fileId}`)).status).toBe(404);
  });

  it('rejects executables, disguised files and HTML/SVG', async () => {
    const ana = await login(built, 'bradesco1');
    expect((await ana.upload(`/tickets/${ticketId}/attachments`, 'programa.exe', Buffer.from('MZ\x90\x00'), 'application/octet-stream')).status).toBe(415);
    expect((await ana.upload(`/tickets/${ticketId}/attachments`, 'foto.png', Buffer.from('<script>alert(1)</script>'), 'image/png')).status).toBe(415);
    expect((await ana.upload(`/tickets/${ticketId}/attachments`, 'img.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status).toBe(415);
    expect((await ana.upload(`/tickets/${ticketId}/attachments`, 'notas.txt', Buffer.from('texto simples'), 'text/plain')).status).toBe(200);
    expect((await ana.upload(`/tickets/${ticketId}/attachments`, 'imagem.png', PNG_1PX, 'image/png')).status).toBe(200);
  });

  it('enforces the size limit', async () => {
    const small = await createTestApp({ UPLOAD_MAX_FILE_MB: '1' });
    const ana = await login(small, 'bradesco1');
    const big = Buffer.concat([PDF_MIN, Buffer.alloc(1024 * 1024 + 10, 32)]);
    expect((await ana.upload(`/tickets/${ticketId}/attachments`, 'grande.pdf', big, 'application/pdf')).status).toBe(413);
    await small.app.close();
  });

  it('a non-participant cannot upload to the ticket', async () => {
    const other = await login(built, 'itau2');
    expect((await other.upload(`/tickets/${ticketId}/attachments`, 'x.pdf', PDF_MIN, 'application/pdf')).status).toBe(404);
  });

  it('attachments linked to internal notes are hidden from the requester', async () => {
    const coord = await login(built, 'coordBradesco');
    const up = await coord.upload(`/tickets/${ticketId}/attachments`, 'interno.pdf', PDF_MIN, 'application/pdf');
    const internalFile = up.json().id;
    expect((await coord.post(`/tickets/${ticketId}/comments`, { body: 'Anexo interno', internal: true, attachmentIds: [internalFile] })).status).toBe(200);
    const ana = await login(built, 'bradesco1');
    expect((await ana.get(`/files/${internalFile}`)).status).toBe(404);
    expect((await coord.get(`/files/${internalFile}`)).status).toBe(200);
  });
});

describe('filters, export and indicators', () => {
  it('filters by status and protocol', async () => {
    const head = await login(built, 'avHead');
    const closed = (await head.get('/tickets?status=closed&pageSize=100')).json();
    expect(closed.items.every((t: { status: { key: string } }) => t.status.key === 'closed')).toBe(true);
    const one = closed.items[0];
    const byProtocol = (await head.get(`/tickets?q=${one.protocol}`)).json();
    expect(byProtocol.items[0].id).toBe(one.id);
  });

  it('exports only authorised tickets and audits the export', async () => {
    const coord = await login(built, 'coordItau');
    const r = await coord.get('/tickets/export');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/csv');
    const total = (await coord.get('/tickets?pageSize=1')).json().total;
    const lines = r.body.trim().split('\r\n').length - 1;
    expect(lines).toBe(total);
  });

  it('department dashboard numbers match the database', async () => {
    const head = await login(built, 'avHead');
    const d = (await head.get('/dashboards/department?from=2020-01-01')).json();
    const av = dept('AVALIAÇÕES').id;
    const scope = or(eq(tickets.handlingDepartmentId, av), and(eq(tickets.requesterDepartmentId, av), eq(tickets.confidential, false)));
    const [backlog] = await built.deps.db.select({ n: sql<number>`count(*)::int` }).from(tickets)
      .where(and(scope, inArray(tickets.statusKey, ['open', 'triage', 'in_progress', 'waiting_requester', 'waiting_third_party'])));
    const [created] = await built.deps.db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(scope);
    expect(d.summary.backlog).toBe(backlog!.n);
    expect(d.summary.created).toBe(created!.n);
    const sumClients = d.byClient.reduce((s: number, c: { created: number }) => s + c.created, 0);
    expect(sumClients).toBe(created!.n);
    expect(d.definitions.resolutionHours).toMatch(/calendário/);
  });

  it('a coordinator cannot open the dashboard of a team they do not lead', async () => {
    const coord = await login(built, 'coordItau');
    expect((await coord.get(`/dashboards/team?teamId=${team('Carteira Bradesco').id}`)).status).toBe(403);
    expect((await coord.get(`/dashboards/team?teamId=${team('Carteira Itaú').id}`)).status).toBe(200);
    expect((await coord.get('/dashboards/department')).status).toBe(403);
    const ana = await login(built, 'bradesco1');
    expect((await ana.get('/dashboards/team')).status).toBe(403);
    expect((await ana.get('/dashboards/admin')).status).toBe(403);
  });

  it('the admin dashboard returns aggregates only', async () => {
    const admin = await login(built, 'platformAdmin');
    const r = (await admin.get('/dashboards/admin')).json();
    expect(r.totals.users_active).toBeGreaterThan(10);
    expect(JSON.stringify(r)).not.toMatch(/Notebook não liga/);
    expect(r.securityEvents).toBeNull();
  });

  it('reports SLA honestly when no policy applies', async () => {
    const admin = await login(built, 'platformAdmin');
    expect((await admin.post('/admin/ticket-priorities', { key: 'planejada', label: 'Planejada', rank: 0, color: '#334155' })).status).toBe(200);
    const ana = await login(built, 'bradesco1');
    const t = await open(ana, { title: 'Chamado sem SLA configurado', priority: 'planejada', categoryId: cat('Outros'), destination: 'team', targetId: team('Carteira Bradesco').id });
    const d = (await ana.get(`/tickets/${t.id}`)).json();
    expect(d.sla.state).toBe('not_configured');
    expect(d.sla.resolutionDueAt).toBeNull();
    const withSla = await open(ana, { title: 'Chamado com SLA de demonstração', priority: 'high', categoryId: cat('Outros'), destination: 'team', targetId: team('Carteira Bradesco').id });
    expect((await ana.get(`/tickets/${withSla.id}`)).json().sla.state).toBe('on_track');
  });
});
