import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
export const E2E_PASSWORD = 'e2e-password-123';

const serverEnv = {
  NODE_ENV: 'test',
  PORT: String(PORT),
  HOST: '127.0.0.1',
  APP_BASE_URL: BASE,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://uon:uon_dev_password@localhost:5432/uon_connect_e2e',
  AUTH_DEV_LOGIN_ENABLED: 'true',
  DEV_LOGIN_PASSWORD: E2E_PASSWORD,
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  LOCAL_AUTH_ENABLED: 'true',
  // Test-only key (encrypts 2FA secrets in the throwaway E2E database). Never reuse it.
  TOKEN_ENCRYPTION_KEY: 'rXmANy4QQHp1ACR/S4iDhQLxJ999WarFTmVYLR1zbNs=',
  WEB_DIST_DIR: 'apps/web/dist',
  STORAGE_LOCAL_DIR: 'test-results/e2e-storage',
  DOWNLOADS_DIR: 'test-results/e2e-downloads',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM ?? undefined,
      // Fake camera/microphone so WebRTC calls can be tested headless.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 }, permissions: ['camera', 'microphone'] }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: 'npx tsx e2e/prepare-db.ts && npm run build --workspace @uon/web && npx tsx apps/api/src/server.ts',
    url: `${BASE}/health/ready`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: serverEnv,
    stdout: 'pipe',
  },
});
