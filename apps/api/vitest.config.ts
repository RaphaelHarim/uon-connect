import { defineConfig } from 'vitest/config';

// Tests always run against a dedicated database (never the one in .env).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://uon:uon_dev_password@localhost:5432/uon_connect_test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL },
  },
});
