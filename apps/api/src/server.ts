import { buildApp } from './app.js';
import { ConfigError, loadEnv } from './config/env.js';
import { BackgroundRunner } from './jobs/runner.js';
import { attachSocketServer } from './realtime/socket.js';

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n[UON CONNECT] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const { app, deps, mailer } = await buildApp(env);
  const io = attachSocketServer(app.server, deps);
  const runner = new BackgroundRunner(deps, mailer);

  await app.listen({ host: env.HOST, port: env.PORT });
  if (env.JOBS_ENABLED) runner.start();
  app.log.info(
    { devLogin: env.devLoginEnabled, entra: env.entraEnabled, email: env.emailConfigured },
    'UON CONNECT API pronta',
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'encerrando com segurança');
    const force = setTimeout(() => process.exit(1), 15_000).unref();
    await runner.stop();
    io.close();
    await app.close();
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
