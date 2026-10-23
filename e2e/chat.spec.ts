import { expect, test } from '@playwright/test';
import { newUser } from './helpers';

test('mensagens chegam em tempo real, com reações e confirmação de leitura', async ({ browser }) => {
  const ana = await newUser(browser, 'ana.costa');
  const diego = await newUser(browser, 'diego.martins');
  await ana.page.goto('/conversas');
  await ana.page.getByRole('link', { name: /^Diego Martins/ }).click();
  await diego.page.goto('/conversas');
  await diego.page.getByRole('link', { name: /^Ana Beatriz Costa/ }).click();

  const text = `Mensagem em tempo real ${Date.now()}`;
  await ana.page.getByLabel('Mensagem', { exact: true }).fill(text);
  await ana.page.keyboard.press('Enter');
  // Arrives on the other side without reloading. (Scoped to the message pane: the conversation
  // list shows the same text as a preview.)
  const received = diego.page.getByLabel('Mensagens').getByText(text);
  await expect(received).toBeVisible();
  // ...and the sender sees it as read once the recipient has the conversation open.
  await expect(ana.page.getByText('Lida').last()).toBeVisible();

  await received.hover();
  await diego.page.getByRole('button', { name: 'Reagir' }).last().click();
  await diego.page.getByRole('button', { name: 'Reagir com 👍' }).click();
  await expect(ana.page.getByRole('button', { name: '👍 1' }).last()).toBeVisible();
});

test('grupo: criação e participantes', async ({ browser }) => {
  const coord = await newUser(browser, 'larissa.souza');
  await coord.page.goto('/conversas');
  await coord.page.getByRole('button', { name: 'Nova', exact: true }).click();
  await coord.page.getByRole('radio', { name: 'Grupo' }).click();
  await coord.page.getByLabel('Nome do grupo').fill('Projeto E2E Itaú');
  await coord.page.getByLabel('Buscar colaboradores').fill('Mariana');
  await coord.page.getByRole('button', { name: /Mariana Gomes/ }).click();
  await coord.page.getByRole('button', { name: /Criar grupo/ }).click();
  await expect(coord.page.getByText('Larissa Souza criou o grupo "Projeto E2E Itaú".')).toBeVisible();
  const mariana = await newUser(browser, 'mariana.gomes');
  await mariana.page.goto('/conversas');
  await expect(mariana.page.getByRole('link', { name: /Projeto E2E Itaú/ })).toBeVisible();
});
