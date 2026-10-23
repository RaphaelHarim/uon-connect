import { type Browser, expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-password-123';
export const email = (name: string) => `${name}@demo.uonconnect.local`;

export async function loginAs(page: Page, who: string) {
  await page.goto('/login');
  await page.getByLabel('Conta de demonstração').selectOption(email(who));
  await page.getByLabel('Senha de teste').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar como conta de demonstração' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' }).or(page.getByRole('navigation', { name: 'Navegação rápida' })).first()).toBeVisible();
}

export async function newUser(browser: Browser, who: string) {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  await loginAs(page, who);
  return { context, page };
}
