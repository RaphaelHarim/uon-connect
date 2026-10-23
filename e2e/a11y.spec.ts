import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

const PAGES = ['/', '/chamados', '/chamados/novo', '/conversas', '/reunioes', '/pessoas', '/organizacao', '/perfil', '/notificacoes'];

test('telas principais sem violações graves de acessibilidade (axe)', async ({ page }) => {
  await page.goto('/login');
  const loginScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(loginScan.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  await loginAs(page, 'fernanda.lopes');
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(serious.map((v) => `${path}: ${v.id} — ${v.help} (${v.nodes.length})`)).toEqual([]);
  }
});

test('modo escuro também passa na verificação', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await loginAs(page, 'diego.martins');
  for (const path of ['/', '/chamados', '/conversas']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => `${path}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
});
