import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

test('redireciona para o login e entra com conta de demonstração', async ({ page }) => {
  await page.goto('/chamados');
  await expect(page).toHaveURL(/\/login\?voltar=%2Fchamados/);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await loginAs(page, 'ana.costa');
  await expect(page.getByText('Ambiente de demonstração')).toBeVisible();
  await page.getByRole('button', { name: 'Menu do perfil' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('senha errada não entra', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Conta de demonstração').selectOption('ana.costa@demo.uonconnect.local');
  await page.getByLabel('Senha de teste').fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar como conta de demonstração' }).click();
  await expect(page.getByText('Credenciais de demonstração inválidas.')).toBeVisible();
});
