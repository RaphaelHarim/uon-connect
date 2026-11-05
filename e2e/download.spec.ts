import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newUser } from './helpers';

test('administração publica o instalador e a página /baixar oferece o download', async ({ browser, page }) => {
  // Public page, before anything is published.
  await page.goto('/baixar');
  await expect(page.getByRole('heading', { name: 'Instale o UON CONNECT' })).toBeVisible();
  await expect(page.getByText('Instalador ainda não publicado pela administração.').first()).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);

  const { page: admin } = await newUser(browser, 'otavio.reis');
  await admin.goto('/admin/instaladores');
  await expect(admin.getByLabel('Link da página de download')).toHaveValue(/\/baixar$/);
  const windows = admin.locator('div.rounded-xl', { hasText: 'Windows' }).first();
  await windows.getByLabel('Versão (opcional)').fill('1.0.0');
  await windows.locator('input[type=file]').setInputFiles({ name: 'UON CONNECT Setup 1.0.0.exe', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 7)]) });
  await expect(admin.getByText('Instalador para Windows publicado')).toBeVisible();

  await page.reload();
  const link = page.getByRole('link', { name: 'Baixar para Windows' });
  await expect(link).toBeVisible();
  await expect(page.getByText(/Versão 1\.0\.0/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toBe('UON-CONNECT-Setup.exe');
});
