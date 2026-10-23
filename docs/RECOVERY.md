# Conta fundadora, recuperação de acesso e backup

## 1. Bootstrap da conta fundadora (uma única vez)

A conta fundadora é a administração máxima da plataforma. Ela é identificada pelo **Object ID (`oid`)** do
usuário no Microsoft Entra ID — não pelo e-mail ou nome.

Pré-requisitos: Entra ID configurado ([INTEGRATIONS.md](INTEGRATIONS.md)), migrações aplicadas e
`db:seed:base` executado.

1. No portal do Entra ID, em **Usuários → (pessoa) → Visão geral**, copie o **ID do objeto** e o **ID do locatário**.
2. No servidor, com a `DATABASE_URL` do **papel proprietário** do banco:

```bash
npm run bootstrap:founder -- \
  --email nome.sobrenome@uongroup.com \
  --name "Nome Sobrenome" \
  --oid 00000000-0000-0000-0000-000000000000 \
  --tenant 00000000-0000-0000-0000-000000000000
# imagem Docker: node apps/api/dist/bootstrap-founder.js --email … --name … --oid … --tenant …
```

3. A pessoa entra com a conta Microsoft. Não existe senha local.

O comando recusa executar se já houver uma conta fundadora e registra `founder.bootstrapped` na auditoria
(autor: usuário e máquina do sistema operacional).

## 2. Proteções

Pelas interfaces e APIs **ninguém** — nem outro Supreme Admin, nem a própria fundadora — consegue excluir,
desativar, rebaixar, editar ou reassociar a conta fundadora; operações em lote a ignoram. Os triggers do
banco repetem essas regras. Somente a fundadora designa e remove outros Supreme Admins.

## 3. Continuidade: evite ponto único de falha

- A fundadora deve designar **pelo menos um outro Supreme Admin** (Administração → Usuários → Conceder Supreme Admin).
  Ele administra tudo, exceto a própria conta fundadora e a designação de Supreme Admins.
- Proteja a conta Microsoft da fundadora com MFA e acesso condicional.

## 4. Procedimento formal de recuperação

Use somente com aprovação registrada (ex.: chamado aprovado pela diretoria). Requer acesso ao servidor e
credenciais do **proprietário** do banco — o papel da aplicação não consegue executá-lo.

**Caso A — a fundadora perdeu a conta Microsoft e recebeu uma nova (novo `oid`):**

```bash
npm run bootstrap:founder -- --recover relink \
  --oid <novo-object-id> --tenant <tenant-id> \
  --reason "Chamado UON-2026-000123 aprovado por <nome/cargo> em <data>" --confirm-recovery
```

**Caso B — transferência da condição de fundadora para outra pessoa** (ex.: desligamento):

```bash
npm run bootstrap:founder -- --recover transfer \
  --to-email nova.pessoa@uongroup.com \
  --reason "Ata da reunião de diretoria de <data>" --confirm-recovery
```

A conta de destino precisa estar ativa e já ter entrado pelo Entra ID. A conta anterior permanece Supreme
Admin até ser revisada pela nova fundadora. Ambos os casos ficam registrados na auditoria
(`founder.recovered_relink` / `founder.recovered_transfer`) com a justificativa.

Depois da recuperação: encerrar sessões da conta afetada (Administração → Usuários → Encerrar sessões) e
verificar a auditoria (`npm run audit:verify`).

## 5. Recuperação de acesso de outros usuários

- Contas desativadas: reativação pela Administração (Supreme Admin para contas administrativas).
- Perda da conta Microsoft: a TI corrige no Entra ID; se o `oid` mudar, um Supreme Admin pode remover o
  vínculo antigo pelo banco (procedimento de suporte) e o próximo login associa pelo e-mail
  (`ENTRA_LINK_BY_EMAIL=true`). Funções e vínculos permanecem.

## 6. Backup e restauração

```bash
# backup (banco + arquivos + SHA256SUMS)
DATABASE_URL=postgres://owner:***@host/uon_connect STORAGE_DIR=/data/files BACKUP_DIR=/backups scripts/backup.sh

# restauração em banco NOVO e vazio
createdb uon_connect_restore
DATABASE_URL=postgres://owner:***@host/uon_connect_restore STORAGE_DIR=/data/files-restore scripts/restore.sh /backups/20261023T120000Z
DATABASE_URL=postgres://owner:***@host/uon_connect_restore npm run audit:verify
```

Testado nesta versão: restauração com contagens idênticas de chamados, mensagens e auditoria, cadeia de
auditoria íntegra e arquivos recuperados; o script recusa restaurar sobre banco não vazio.

Recomendações: agendar backup diário (cron/systemd), copiar para local externo cifrado, manter 30 dias,
testar restauração mensalmente em homologação. Após restaurar, recrie o papel `uon_app`
(`docker/postgres/app-role.sql`).

## 7. Mecanismos de emergência que **não** existem (por decisão)

Senha mestra, conta oculta, rota HTTP de recuperação, variável de ambiente que libere acesso administrativo.
