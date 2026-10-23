import { expect, test } from '@playwright/test';
import { newUser } from './helpers';

test('chamada de vídeo entre duas pessoas conecta de verdade (WebRTC)', async ({ browser }) => {
  const diego = await newUser(browser, 'diego.martins');
  const ana = await newUser(browser, 'ana.costa');
  await ana.page.goto('/');

  await diego.page.goto('/conversas');
  await diego.page.getByRole('link', { name: /^Ana Beatriz Costa/ }).click();
  await diego.page.getByRole('button', { name: 'Iniciar chamada de vídeo' }).click();
  await expect(diego.page).toHaveURL(/\/reunioes\/.+/);
  await expect(diego.page.getByText('Na chamada', { exact: true })).toBeVisible();

  // The invite reaches Ana in real time.
  await expect(ana.page.getByText('Diego Martins está chamando você')).toBeVisible();
  await ana.page.goto(diego.page.url().replace(/\?.*/, ''));
  await ana.page.getByRole('button', { name: 'Entrar na chamada' }).click();

  // Both sides see the other's tile with an established peer connection.
  await expect(diego.page.locator('[data-testid=video-tile][data-state=connected]')).toHaveCount(2, { timeout: 20_000 });
  await expect(ana.page.locator('[data-testid=video-tile][data-state=connected]')).toHaveCount(2, { timeout: 20_000 });
  // The remote tile is actually receiving frames from the other browser's (fake) camera.
  await expect
    .poll(() => ana.page.locator('[data-testid=video-tile] video').nth(1).evaluate((v: HTMLVideoElement) => !!v.srcObject && v.readyState >= 2 && v.videoWidth > 0), { timeout: 15_000 })
    .toBe(true);

  await ana.page.getByRole('button', { name: 'Desativar microfone' }).click();
  await expect(diego.page.getByLabel('Microfone desativado')).toBeVisible();

  await diego.page.getByRole('button', { name: 'Encerrar para todos' }).click();
  await diego.page.getByRole('button', { name: 'Encerrar', exact: true }).click();
  await expect(ana.page.getByText('A chamada foi encerrada.')).toBeVisible();
});
