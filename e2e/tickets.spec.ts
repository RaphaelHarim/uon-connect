import { expect, test } from '@playwright/test';
import { newUser } from './helpers';

test('fluxo completo de um chamado entre colaboradora, coordenação e responsável', async ({ browser }) => {
  const title = `Revisão de laudo E2E ${Date.now()}`;
  const ana = await newUser(browser, 'ana.costa');
  await ana.page.goto('/chamados/novo');
  await ana.page.getByLabel('Título').fill(title);
  await ana.page.getByLabel('Descrição').fill('Preciso de revisão do laudo do imóvel da Rua das Flores.');
  await ana.page.getByLabel('Categoria').selectOption({ label: 'Solicitação ao gestor' });
  await ana.page.getByLabel('Enviar para').selectOption({ label: 'Coordenação — Carteira Bradesco (AVALIAÇÕES)' });
  await ana.page.locator('input[type=file]').setInputFiles({ name: 'evidencia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await ana.page.getByRole('button', { name: 'Abrir chamado' }).click();
  await expect(ana.page.getByRole('heading', { name: title })).toBeVisible();
  await expect(ana.page.getByText('evidencia.pdf')).toBeVisible();
  const protocol = (await ana.page.locator('span.font-mono').first().textContent())!;
  expect(protocol).toMatch(/^UON-\d{4}-\d{6}$/);
  const url = ana.page.url();

  // The coordinator finds it in the queue and assigns it.
  const diego = await newUser(browser, 'diego.martins');
  await diego.page.goto('/chamados?view=queue');
  await diego.page.getByPlaceholder('Protocolo ou título').fill(protocol);
  await diego.page.getByRole('link', { name: new RegExp(title) }).click();
  await diego.page.getByLabel('Responsável').selectOption({ label: 'Lucas Pereira' });
  await expect(diego.page.getByText('Responsável atualizado')).toBeVisible();

  // The assignee answers and resolves.
  const lucas = await newUser(browser, 'lucas.pereira');
  await lucas.page.goto(url);
  await lucas.page.getByRole('button', { name: 'Iniciar atendimento' }).click();
  await lucas.page.getByLabel('Responder').fill('Laudo revisado e anexado ao processo.');
  await lucas.page.getByRole('button', { name: 'Enviar' }).click();
  await expect(lucas.page.getByText('Laudo revisado e anexado ao processo.')).toBeVisible();
  await lucas.page.getByRole('button', { name: 'Marcar como resolvido' }).click();
  await expect(lucas.page.getByText('Resolvido', { exact: true }).first()).toBeVisible();

  // The requester confirms and closes.
  await ana.page.reload();
  await expect(ana.page.getByText('Laudo revisado e anexado ao processo.')).toBeVisible();
  await ana.page.getByRole('button', { name: 'Confirmar e encerrar' }).click();
  await expect(ana.page.getByText('Encerrado', { exact: true }).first()).toBeVisible();

  // Someone from another portfolio cannot open it.
  const mariana = await newUser(browser, 'mariana.gomes');
  await mariana.page.goto(url);
  await expect(mariana.page.getByText('Chamado não encontrado.')).toBeVisible();
});
