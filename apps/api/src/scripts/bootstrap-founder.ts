import os from 'node:os';
import { parseArgs } from 'node:util';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';
import { companies, localCredentials, userIdentities, userRoles, users } from '../db/schema/index.js';
import { recordAudit } from '../modules/audit/service.js';
import { issueLocalToken } from '../modules/auth/local-service.js';

/**
 * Founder account bootstrap and formal recovery (see docs/RECOVERY.md).
 *
 * This runs with database credentials on the server — there is no HTTP route for it. With the
 * Entra ID the founder is identified by the immutable object id (oid), never by e-mail alone; with
 * local accounts it gets a one-time link, printed here, to choose its own password.
 *
 *   bootstrap (Entra ID):     --email <e> --name <n> --oid <object-id> [--tenant <tenant-id>]
 *   bootstrap (local login):  --email <e> --name <n> --local
 *   recovery (new password link for the founder's local login; also clears 2FA and lockout):
 *              --recover reset-local --reason "<ticket/approval>" --confirm-recovery
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
    local: { type: 'boolean' },
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
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entraTenant = () => {
  const tenant = a.tenant ?? process.env.ENTRA_TENANT_ID ?? fail('Informe --tenant ou ENTRA_TENANT_ID.');
  if (!GUID.test(tenant)) fail('Tenant ID inválido (esperado um GUID).');
  return tenant;
};
const baseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const INVITE_TTL_MS = Number(process.env.LOCAL_AUTH_INVITE_TTL_HOURS ?? 72) * 3_600_000;
const operator = `cli:${os.userInfo().username}@${os.hostname()}`;

const { db, pool } = createDatabase(url, 1);

async function main() {
  const [existing] = await db.select().from(users).where(eq(users.isFounder, true));

  if (!a.recover) {
    if (existing) fail('Já existe uma conta fundadora. Para alterá-la use o procedimento de recuperação (--recover).');
    const email = (a.email ?? fail('Informe --email.')).toLowerCase();
    const name = a.name ?? fail('Informe --name.');
    const local = !!a.local;
    if (local && a.oid) fail('Use --local ou --oid, não os dois.');
    const oid = local ? '' : (a.oid ?? fail('Informe --oid (Object ID no Entra ID) ou --local (login com usuário e senha).'));
    if (!local && !GUID.test(oid)) fail('Object ID inválido (esperado um GUID).');
    const tenant = local ? '' : entraTenant();
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
      if (local) {
        const [identity] = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, 'local')));
        if (!identity) await tx.insert(userIdentities).values({ userId: user.id, provider: 'local', subject: user.id, emailAtLink: email });
        await tx.insert(localCredentials).values({ userId: user.id }).onConflictDoNothing();
        const { token, expiresAt } = await issueLocalToken(tx, { userId: user.id, purpose: 'invite', ttlMs: INVITE_TTL_MS });
        await recordAudit(tx, { actorLabel: operator, action: 'founder.bootstrapped', resourceType: 'user', resourceId: user.id, outcome: 'success', metadata: { email, method: 'local' } });
        console.log(`\nConta fundadora configurada: ${name} <${email}> (id ${user.id}).`);
        console.log('Abra o link abaixo para definir a senha. Ele só funciona uma vez e expira em', expiresAt.toISOString());
        console.log(`\n  ${baseUrl}/definir-senha#${token}\n`);
        console.log('Não envie este link por canais públicos. Depois de entrar, ative a verificação em duas etapas.\n');
      } else {
        await tx.delete(userIdentities).where(and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, 'entra')));
        await tx.insert(userIdentities).values({ userId: user.id, provider: 'entra', tenantId: tenant, subject: oid, emailAtLink: email });
        await recordAudit(tx, { actorLabel: operator, action: 'founder.bootstrapped', resourceType: 'user', resourceId: user.id, outcome: 'success', metadata: { email, tenant } });
        console.log(`\nConta fundadora configurada: ${name} <${email}> (id ${user.id}).`);
        console.log('Ela entra pelo Microsoft Entra ID.\n');
      }
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
      const tenant = entraTenant();
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
      const [hasIdentity] = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, target!.id), inArray(userIdentities.provider, ['entra', 'local'])));
      if (!hasIdentity) fail('A conta de destino precisa ter entrado ao menos uma vez (Entra ID ou senha local).');
      await tx.update(users).set({ isFounder: false }).where(eq(users.id, existing!.id));
      await tx.update(users).set({ isFounder: true }).where(eq(users.id, target!.id));
      await tx.insert(userRoles).values({ userId: target!.id, role: 'supreme_admin' }).onConflictDoNothing();
      await recordAudit(tx, { actorLabel: operator, action: 'founder.recovered_transfer', resourceType: 'user', resourceId: target!.id, outcome: 'success', metadata: { reason, previousFounder: existing!.id } });
      console.log(`\nConta fundadora transferida para ${to}. A conta anterior permanece Supreme Admin até ser revisada pela nova fundadora.\n`);
    } else if (a.recover === 'reset-local') {
      const [identity] = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, existing!.id), eq(userIdentities.provider, 'local')));
      if (!identity) await tx.insert(userIdentities).values({ userId: existing!.id, provider: 'local', subject: existing!.id, emailAtLink: existing!.email });
      await tx.insert(localCredentials).values({ userId: existing!.id }).onConflictDoNothing();
      await tx.update(localCredentials).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, failedAttempts: 0, lockedUntil: null }).where(eq(localCredentials.userId, existing!.id));
      const { token, expiresAt } = await issueLocalToken(tx, { userId: existing!.id, purpose: 'reset', ttlMs: 24 * 3_600_000 });
      await tx.update(users).set({ status: 'active' }).where(eq(users.id, existing!.id));
      await recordAudit(tx, { actorLabel: operator, action: 'founder.recovered_reset_local', resourceType: 'user', resourceId: existing!.id, outcome: 'success', metadata: { reason } });
      console.log('\nLink de redefinição da conta fundadora (uso único, expira em', expiresAt.toISOString(), '):');
      console.log(`\n  ${baseUrl}/definir-senha#${token}\n`);
      console.log('A verificação em duas etapas foi desativada; reative-a após entrar. Definir a senha encerra as sessões abertas.\n');
    } else {
      fail('Valor de --recover inválido (use relink, transfer ou reset-local).');
    }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
