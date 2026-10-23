# API HTTP

- Base: `/api/v1`. Respostas JSON; erros `{ "error": { "code", "message", "details?", "correlationId" } }`.
- **OpenAPI/Swagger**: em desenvolvimento e homologação, `GET /api/docs` (gerado dos esquemas Zod). Desativado
  em produção.
- Autenticação por cookie de sessão. Requisições que alteram estado exigem os cabeçalhos
  `x-requested-with: uon-connect` e `x-csrf-token: <csrfToken de GET /me>`.
- Tempo real: Socket.IO em `/socket.io` (mesmo cookie).
- Saúde: `GET /health/live`, `GET /health/ready`.

## Rotas (resumo)

| Área | Rotas |
| --- | --- |
| Autenticação | `GET /auth/providers` · `POST /auth/dev-login` · `GET /auth/entra/login` · `GET /auth/entra/callback` · `POST /auth/logout` |
| Senha local | `POST /auth/login` (→ `mfaRequired` + `challenge`) · `POST /auth/login/mfa` · `POST /auth/password/inspect` · `POST /auth/password/set` · `GET /me/security` · `POST /me/password` · `POST /me/mfa/setup|enable|disable` · admin: `GET /admin/users/:id/local` · `POST /admin/users/:id/local-access|local-unlock|mfa-reset` |
| Eu | `GET /config` · `GET/PATCH /me` · `PUT /me/preferences` · `GET /me/sessions` · `DELETE /me/sessions/:ref` · `POST/DELETE /me/avatar` · `PUT /me/presence` · `GET/POST /me/absences` · `POST /me/absences/:id/activate|end` |
| Pessoas | `GET /directory` · `GET /users/:id/profile` · `GET /users/:id/avatar` · `GET /users/:id/absence` · `GET /presence?ids=` |
| Organização | `GET /org/structure` · `POST/PUT /admin/departments` · `/admin/teams` · `/admin/clients` |
| Usuários (admin) | `GET/POST /admin/users` · `GET/PATCH /admin/users/:id` · `POST /admin/users/:id/status` · `POST /admin/users/bulk-status` · `POST/DELETE /admin/users/:id/roles[/:role]` · `PUT/DELETE /admin/users/:id/departments[/:id]` · `PUT/DELETE /admin/users/:id/teams[/:id]` · `POST /admin/users/:id/revoke-sessions` · `GET /admin/users/:id/effective-access` |
| Chamados | `GET /tickets/form-options` · `GET /tickets/statuses` · `GET/POST /tickets` · `GET /tickets/export` · `GET /tickets/:id` · `POST /tickets/:id/comments|status|assign|priority|watchers|attachments` · `GET /tickets/:id/assignable` · `DELETE /tickets/:id/watchers/:userId` |
| Config. de chamados | `GET /admin/ticket-config` · categorias, prioridades, status, transições, calendários, feriados, políticas de SLA |
| Dashboards | `GET /dashboards/scopes|personal|team|department|admin` · `GET /dashboards/department/export` |
| Conversas | `GET /conversations` · `POST /conversations/direct|groups` · `GET/PATCH /conversations/:id` · membros, papéis, preferências · `GET/POST /conversations/:id/messages` · `POST /conversations/:id/read` · `GET/POST /conversations/:id/files` · `PATCH/DELETE /messages/:id` · `POST /messages/:id/reactions` · `GET /messages/search` |
| Reuniões | `GET/POST /meetings` · `GET /meetings/:id` · `POST /meetings/:id/respond|participants|end|create-group` · `GET /calls/ice-servers` |
| Arquivos | `GET /files/:id` (autorização por vínculo do arquivo) |
| Notificações | `GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/:id/read` · `POST /notifications/read-all` |
| Busca | `GET /search?q=` |
| Auditoria | `GET /admin/audit` · `GET /admin/audit/export` · `GET /admin/audit/verify` |
| Plataforma | `GET/PUT /admin/settings` · `GET /admin/jobs` · `GET /admin/integrations` · `POST /admin/integrations/:key/check` · `GET /integrations/calendar/events` · `GET /integrations/status` |

## Eventos em tempo real

Servidor → cliente: `message:new`, `message:updated`, `conversation:updated`, `conversation:read`, `typing`,
`presence:update`, `notification:new`, `ticket:updated`, `session:revoked`, `call:invite`, `call:peer-joined`,
`call:peer-left`, `call:signal`, `call:media`, `call:ended`, `meeting:updated`, `meeting:response`.

Cliente → servidor: `presence:idle`, `typing`, `call:join` (com confirmação), `call:signal`, `call:media`, `call:leave`.
