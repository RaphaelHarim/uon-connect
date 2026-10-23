import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { currentStep, totpAt } from '../apps/api/src/auth/local';
import { newUser } from './helpers';

async function expectAccessible(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => `${where}: ${v.id} (${v.nodes.length})`)).toEqual([]);
}

const PASSWORD = 'frase longa para o teste de ponta a ponta';

test('convite → definir senha → login por senha → ativar 2FA → login com código', async ({ browser }) => {
  const email = `convidado.${Date.now()}@exemplo.test`;

  // Administrator creates the account and generates the invitation link.
  const { page: admin } = await newUser(browser, 'rafael.nunes');
  await admin.goto('/admin/usuarios');
  await admin.getByRole('button', { name: 'Novo usuário' }).click();
  await admin.getByLabel('E-mail corporativo').fill(email);
  await admin.getByRole('textbox', { name: 'Nome', exact: true }).fill('Pessoa Convidada');
  await admin.getByRole('button', { name: 'Criar' }).click();
  await expect(admin.getByRole('heading', { name: 'Pessoa Convidada' })).toBeVisible();
  await admin.getByRole('button', { name: 'Gerar convite' }).click();
  const link = await admin.getByLabel('Link de acesso').inputValue();
  expect(link).toContain('/definir-senha#');

  // The invited person, in a fresh browser, sets the password.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Crie sua senha' })).toBeVisible();
  await expect(page).not.toHaveURL(/#/); // token removed from the address bar
  await expectAccessible(page, 'definir-senha');
  await page.getByLabel('Nova senha').fill(PASSWORD);
  await page.getByLabel('Confirme a senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Salvar senha' }).click();
  await expect(page.getByText('Senha definida. Entre com seu e-mail e a nova senha.')).toBeVisible();

  // The same link can't be used twice.
  const reuse = await ctx.newPage();
  await reuse.goto(link);
  await expect(reuse.getByRole('heading', { name: 'Link indisponível' })).toBeVisible();
  await reuse.close();

  await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Senha', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();

  // Turn on two-step verification with the secret shown on screen.
  await page.goto('/perfil?aba=seguranca');
  await page.getByRole('button', { name: 'Configurar no celular' }).click();
  await expect(page.getByAltText('QR code para configurar o aplicativo autenticador')).toBeVisible();
  await expectAccessible(page, 'perfil/seguranca');
  const secret = (await page.locator('code').first().textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill(totpAt(secret, currentStep()));
  await page.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText('Ativa', { exact: true })).toBeVisible();

  // Sign out and back in: now the code is required after the password.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Senha', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Verificação em duas etapas')).toBeVisible();
  await page.getByLabel('Código do aplicativo autenticador').fill(totpAt(secret, currentStep() + 1));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await ctx.close();
});
