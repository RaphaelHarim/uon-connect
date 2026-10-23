import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

test('navegação essencial em tela de celular', async ({ page }) => {
  await loginAs(page, 'ana.costa');
  const tabbar = page.getByRole('navigation', { name: 'Navegação rápida' });
  await expect(tabbar).toBeVisible();
  await tabbar.getByRole('link', { name: 'Chamados' }).click();
  await expect(page.getByRole('heading', { name: 'Chamados' })).toBeVisible();
  // No horizontal scrolling on small screens.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await tabbar.getByRole('link', { name: 'Conversas' }).click();
  await page.getByRole('link', { name: /^Diego Martins/ }).click();
  await expect(page.getByLabel('Mensagem', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar às conversas' }).click();
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Pessoas' }).click();
  await expect(page.getByRole('heading', { name: 'Pessoas' })).toBeVisible();
});

test('PWA: manifesto e service worker disponíveis', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'UON CONNECT', display: 'standalone', lang: 'pt-BR' });
  expect((await request.get('/sw.js')).status()).toBe(200);
  await page.goto('/login');
  await expect(page.locator('link[rel=manifest]')).toHaveCount(1);
});
