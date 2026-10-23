import os from 'node:os';
import { parseArgs } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';
import { companies, userIdentities, userRoles, users } from '../db/schema/index.js';
import { recordAudit } from '../modules/audit/service.js';

/**
 * Founder account bootstrap and formal recovery (see docs/RECOVERY.md).
 *
 * This runs with database credentials on the server — there is no HTTP route for it. The founder
 * is identified by the immutable Entra ID object id (oid) of the tenant, never by e-mail alone.
 *
 *   bootstrap: --email <e> --name <n> --oid <object-id> [--tenant <tenant-id>]
 *   recovery (re-link the founder to a new Entra object id):
 *              --recover relink --oid <new-oid> --reason "<ticket/approval>" --confirm-recovery
 *   recovery (transfer the founder role to another existing account):
 *              --recover transfer --to-email <e> --reason "<ticket/approval>" --confirm-recovery
 */
const { values: a } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    oid: { type: 'string' },
    tenant: { type: 'string' },
    recover: { type: 'string' },
    'to-email': { type: 'string' },
    reason: { type: 'string' },
    'confirm-recovery': { type: 'boolean' },
  },
});

const fail = (m: string): never => {
  console.error(`\nErro: ${m}\n`);
  process.exit(1);
};

const url = process.env.DATABASE_URL ?? fail('DATABASE_URL não definido.');
const tenant = a.tenant ?? process.env.ENTRA_TENANT_ID ?? fail('Informe --tenant ou ENTRA_TENANT_ID.');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!GUID.test(tenant)) fail('Tenant ID inválido (esperado um GUID).');
const operator = `cli:${os.userInfo().username}@${os.hostname()}`;

const { db, pool } = createDatabase(url, 1);

async function main() {
  const [existing] = await db.select().from(users).where(eq(users.isFounder, true));

  if (!a.recover) {
    if (existing) fail('Já existe uma conta fundadora. Para alterá-la use o procedimento de recuperação (--recover).');
    const email = (a.email ?? fail('Informe --email.')).toLowerCase();
    const name = a.name ?? fail('Informe --name.');
    const oid = a.oid ?? fail('Informe --oid (Object ID do usuário no Entra ID).');
    if (!GUID.test(oid)) fail('Object ID inválido (esperado um GUID).');
    const [company] = await db.select().from(companies).limit(1);
    if (!company) fail('Execute antes: npm run db:seed:base');

    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL uon.founder_recovery = 'on'`);
      const [found] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`);
      if (found?.isDemo) fail('O e-mail informado pertence a uma conta de demonstração.');
      const user = found
        ? (await tx.update(users).set({ isFounder: true, status: 'active', displayName: name }).where(eq(users.id, found.id)).returning())[0]!
        : (await tx.insert(users).values({ companyId: company!.id, email, displayName: name, isFounder: true }).returning())[0]!;
      await tx.insert(userRoles).values({ userId: user.id, role: 'supreme_admin' }).onConflictDoNothing();
      await tx.delete(userIdentities).where(and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, 'entra')));
      await tx.insert(userIdentities).values({ userId: user.id, provider: 'entra', tenantId: tenant, subject: oid, emailAtLink: email });
      await recordAudit(tx, { actorLabel: operator, action: 'founder.bootstrapped', resourceType: 'user', resourceId: user.id, outcome: 'success', metadata: { email, tenant } });
      console.log(`\nConta fundadora configurada: ${name} <${email}> (id ${user.id}).`);
      console.log('Ela entra pelo Microsoft Entra ID; não existe senha local.\n');
    });
    return;
  }

  // ---------------------------------------------------------------- recovery
  if (!a['confirm-recovery']) fail('A recuperação exige --confirm-recovery.');
  const reason = a.reason?.trim() ?? '';
  if (reason.length < 10) fail('Informe --reason com a justificativa e a referência da aprovação formal.');
  if (!existing) fail('Não há conta fundadora configurada; use o bootstrap normal.');

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL uon.founder_recovery = 'on'`);
    if (a.recover === 'relink') {
      const oid = a.oid ?? fail('Informe --oid.');
      if (!GUID.test(oid)) fail('Object ID inválido.');
      await tx.delete(userIdentities).where(and(eq(userIdentities.userId, existing!.id), eq(userIdentities.provider, 'entra')));
      await tx.insert(userIdentities).values({ userId: existing!.id, provider: 'entra', tenantId: tenant, subject: oid, emailAtLink: existing!.email });
      await tx.update(users).set({ status: 'active' }).where(eq(users.id, existing!.id));
      await recordAudit(tx, { actorLabel: operator, action: 'founder.recovered_relink', resourceType: 'user', resourceId: existing!.id, outcome: 'success', metadata: { reason, tenant } });
      console.log('\nIdentidade da conta fundadora reassociada. Todas as sessões anteriores continuam válidas até expirar; revogue-as se necessário.\n');
    } else if (a.recover === 'transfer') {
      const to = (a['to-email'] ?? fail('Informe --to-email.')).toLowerCase();
      const [target] = await tx.select().from(users).where(sql`lower(${users.email}) = ${to}`);
      if (!target || target.status !== 'active' || target.isDemo) fail('Conta de destino inexistente, inativa ou de demonstração.');
      const [hasEntra] = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, target!.id), eq(userIdentities.provider, 'entra')));
      if (!hasEntra) fail('A conta de destino precisa ter feito login pelo Entra ID ao menos uma vez.');
      await tx.update(users).set({ isFounder: false }).where(eq(users.id, existing!.id));
      await tx.update(users).set({ isFounder: true }).where(eq(users.id, target!.id));
      await tx.insert(userRoles).values({ userId: target!.id, role: 'supreme_admin' }).onConflictDoNothing();
      await recordAudit(tx, { actorLabel: operator, action: 'founder.recovered_transfer', resourceType: 'user', resourceId: target!.id, outcome: 'success', metadata: { reason, previousFounder: existing!.id } });
      console.log(`\nConta fundadora transferida para ${to}. A conta anterior permanece Supreme Admin até ser revisada pela nova fundadora.\n`);
    } else {
      fail('Valor de --recover inválido (use relink ou transfer).');
    }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
