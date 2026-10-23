import { expect, test } from '@playwright/test';
import { loginAs, newUser } from './helpers';

test('colaborador comum não acessa a administração (interface e API)', async ({ page }) => {
  await loginAs(page, 'ana.costa');
  await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0);
  await page.goto('/admin/usuarios');
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/v1/admin/users')).status);
  expect(status).toBe(403);
});

test('a conta fundadora aparece protegida para outro Supreme Admin', async ({ browser }) => {
  const { page } = await newUser(browser, 'rafael.nunes');
  await page.goto('/admin/usuarios?q=Helena');
  await page.getByRole('link', { name: /Helena Prado/ }).click();
  await expect(page.getByText('Conta fundadora protegida')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desativar' })).toHaveCount(0);
  // A forged direct request is refused by the server too.
  const r = await page.evaluate(async () => {
    const me = await (await fetch('/api/v1/me')).json();
    const users = await (await fetch('/api/v1/admin/users?q=Helena')).json();
    const res = await fetch(`/api/v1/admin/users/${users.items[0].id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'uon-connect', 'x-csrf-token': me.csrfToken },
      body: JSON.stringify({ status: 'inactive' }),
    });
    return { status: res.status, body: await res.json() };
  });
  expect(r.status).toBe(403);
  expect(r.body.error.code).toBe('founder_protected');
});

test('administração técnica não vê conteúdo de chamados', async ({ page }) => {
  await loginAs(page, 'otavio.reis');
  await page.goto('/chamados');
  await expect(page.getByText('Nenhum chamado encontrado')).toBeVisible();
});
