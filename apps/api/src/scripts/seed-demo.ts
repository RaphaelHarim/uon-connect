import { createDatabase } from '../db/client.js';
import { DEMO_PEOPLE, DemoSeedRefused, demoEmail, seedDemo } from '../db/seed/demo.js';

/**
 * Creates fictitious demonstration data. Runs only when explicitly confirmed, never in production
 * and never in a database that already contains real users.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Recusado: o seed de demonstração não pode ser executado com NODE_ENV=production.');
  process.exit(1);
}
if (!process.argv.includes('--confirm')) {
  console.error('Este comando cria dados FICTÍCIOS de demonstração. Execute novamente com --confirm:\n  npm run db:seed:demo -- --confirm');
  process.exit(1);
}
const { db, pool } = createDatabase(url, 1);
seedDemo(db)
  .then(() => {
    console.log('\nDados de demonstração criados. Usuários (todos fictícios, senha = DEV_LOGIN_PASSWORD):');
    for (const p of Object.values(DEMO_PEOPLE)) console.log(`  ${demoEmail(p.name).padEnd(48)} ${p.title}`);
  })
  .catch((err) => {
    console.error(err instanceof DemoSeedRefused ? `Recusado: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
