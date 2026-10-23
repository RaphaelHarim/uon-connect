# Banco de dados

PostgreSQL 16. Esquema em `apps/api/src/db/schema/index.ts`; migrações SQL em `apps/api/drizzle/`.

## Convenções

- IDs `uuid` (`gen_random_uuid()`), exceto séries de alto volume (`audit_events`, `ticket_events`, `jobs`: `bigserial`).
- Datas em `timestamptz` (UTC no banco; a interface converte para o fuso do usuário; SLA usa o fuso do calendário).
- Chaves estrangeiras em todos os relacionamentos; `CHECK` para regras simples (ex.: término de ausência > início).
- Exclusão física evitada: usuários são desativados (`status`), mensagens recebem `deleted_at`, arquivos `deleted_at`.
- `updated_at` mantido por trigger.

## Entidades

| Grupo | Tabelas |
| --- | --- |
| Organização | `companies`, `departments`, `teams` (equipe ou carteira; `client_id` opcional), `clients` |
| Pessoas e acesso | `users`, `user_identities` (provedor + tenant + `oid`), `user_roles`, `department_memberships` (member/agent/head), `team_memberships` (member/coordinator), `sessions`, `auth_flows`, `oauth_tokens` (cifrados), `user_preferences` |
| Chamados | `tickets`, `ticket_comments`, `ticket_attachments`, `ticket_events`, `ticket_watchers`, `ticket_categories`, `ticket_priorities`, `ticket_statuses`, `ticket_status_transitions`, `business_calendars`, `business_holidays`, `sla_policies` |
| Comunicação | `conversations` (direct/group, `direct_key` único por par), `conversation_members`, `messages` (índice GIN de busca em português), `message_attachments`, `message_reactions`, `message_mentions` |
| Reuniões e presença | `meetings`, `meeting_participants`, `user_presence`, `absence_schedules` |
| Plataforma | `notifications` (deduplicação por chave enquanto não lida), `files`, `audit_events`, `system_settings`, `integration_status`, `integration_events`, `jobs` |

Observações de modelagem:
- O nome sugerido "Groups" foi incorporado a `conversations` (tipo `group`); "ClientAssignments" a
  `teams.client_id`; "TicketAssignments" ao campo `tickets.assignee_id` + histórico em `ticket_events`.
- O protocolo (`UON-AAAA-NNNNNN`) usa a sequência de `tickets.number` — único e sem lacunas reutilizadas.

## Triggers de segurança (migração `0001_security_triggers.sql`)

| Trigger | Efeito |
| --- | --- |
| `users_protect_founder` | Impede criar, excluir, desativar ou remover o indicador da conta fundadora; índice único garante no máximo uma |
| `user_roles_protect_founder` | Impede remover a função `supreme_admin` da fundadora |
| `user_identities_protect_founder` | Impede criar/trocar/remover identidades da fundadora (atualizar `last_login_at` é permitido) |
| `audit_events_chain` | Calcula `prev_hash` e `hash` (SHA-256) sob *advisory lock* |
| `audit_events_no_update` / `_no_truncate` | Auditoria somente inclusão |

A exceção controlada (`SET LOCAL uon.founder_recovery = 'on'`) só tem efeito para quem é **proprietário das
tabelas** (ou superusuário). Em produção, a aplicação usa o papel `uon_app`, que não é proprietário — ver
`docker/postgres/app-role.sql`.

## Índices principais

Chamados por solicitante, responsável, fila (departamento/equipe + status), equipe solicitante, carteira,
datas; mensagens por conversa e data; GIN de texto; notificações por usuário/não lidas; auditoria por data,
autor, recurso e ação; sessões por usuário.

## Migrações

```bash
npm run db:generate   # após alterar o esquema TypeScript → gera SQL em apps/api/drizzle
npm run db:migrate    # aplica pendentes (idempotente, registra em drizzle.__drizzle_migrations)
```

Migrações SQL personalizadas (triggers, funções): `npx drizzle-kit generate --custom --name <nome>`.
Em produção, migrações rodam com o papel proprietário; a aplicação, com `uon_app`.

## Dados de demonstração × dados reais

- `db:seed:base`: somente estrutura (departamentos, carteiras, categorias, status, calendário). Pode rodar em produção.
- `db:seed:demo -- --confirm`: pessoas, chamados e mensagens **fictícios** (`is_demo = true`, domínio
  `demo.uonconnect.local`). Recusa `NODE_ENV=production` e qualquer banco que já tenha usuários reais.
- A interface exibe faixa "Ambiente de demonstração" quando há dados fictícios.

## Backup, restauração e retenção

- Backup: `scripts/backup.sh` (pg_dump formato custom + arquivos + SHA256SUMS). Restauração: `scripts/restore.sh`
  (verifica integridade, exige banco vazio). Procedimento testado: contagens idênticas e cadeia de auditoria íntegra
  após restaurar. Detalhes em [RECOVERY.md](RECOVERY.md).
- Recomendação: backup diário + retenção 30 dias, cópia externa cifrada, teste de restauração mensal; para RPO
  menor, PostgreSQL gerenciado com PITR.
- Retenção sugerida (a aprovar pela UON/jurídico, ver [PRIVACY.md](PRIVACY.md)): auditoria ≥ 5 anos; chamados e
  mensagens enquanto houver finalidade; sessões expiradas removidas após 90 dias (automático).
