import { createDatabase } from '../db/client.js';
import { seedBase } from '../db/seed/base.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}
const { db, pool } = createDatabase(url, 1);
seedBase(db)
  .then(() => console.log('Configuração inicial aplicada (departamentos, carteiras, categorias, prioridades, status, transições e calendário).'))
  .catch((err) => {
    console.error('Falha no seed de configuração:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
