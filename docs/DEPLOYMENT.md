# Implantação

> **Caminho recomendado:** `scripts/install.sh` faz tudo desta página em um comando (segredos, banco, papel
> mínimo, HTTPS com Caddy, conta fundadora) e `scripts/install.sh --update` atualiza. Passo a passo para a TI,
> inclusive no Azure, em [INSTALAR.md](INSTALAR.md). O restante desta página descreve o processo manual.

## Topologia recomendada (inicial)

```
Internet/rede UON ──HTTPS──▶ proxy reverso (TLS) ──▶ contêiner "app" (API + interface) ──▶ PostgreSQL 16
                                                     └─ volume /data (arquivos privados)
                    UDP/TCP 3478 + 49160-49200 ──▶ coturn (opcional, chamadas entre redes)
```

Uma VM (2 vCPU, 4 GB RAM) atende o porte inicial. PostgreSQL pode ser gerenciado (Azure Database for
PostgreSQL, RDS) — preferível pelo backup com PITR.

## 1. Preparação

1. DNS: `connect.<domínio>` apontando para o proxy.
2. Certificado TLS no proxy (Caddy/Nginx/Traefik ou load balancer da nuvem). Encaminhe `X-Forwarded-*`
   e o upgrade de WebSocket em `/socket.io`.
3. Registro do aplicativo no Entra ID ([INTEGRATIONS.md](INTEGRATIONS.md)).
4. Copie `.env.example` → `.env.production` e preencha. Obrigatórios: `APP_BASE_URL=https://…` e ao menos
   um método de login: variáveis do Entra ID e/ou `LOCAL_AUTH_ENABLED=true` + `TOKEN_ENCRYPTION_KEY`.
   **Não** defina `AUTH_DEV_LOGIN_ENABLED` (o servidor recusa iniciar).

Exemplo Caddy:

```
connect.exemplo.com {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
```

## 2. Primeira implantação (Docker Compose)

Os comandos abaixo supõem as variáveis exportadas no shell; com o arquivo, use
`docker compose --env-file .env.production -f docker-compose.prod.yml …`.

```bash
export POSTGRES_OWNER_PASSWORD='…' POSTGRES_APP_PASSWORD='…'
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml run --rm migrate                      # migrações (proprietário)
docker compose -f docker-compose.prod.yml run --rm migrate node apps/api/dist/seed-base.js
# papel de execução da aplicação (sem DDL, sem alterar auditoria)
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U uon_owner -d uon_connect -v ON_ERROR_STOP=1 -v app_password="$POSTGRES_APP_PASSWORD" -f - < docker/postgres/app-role.sql
docker compose -f docker-compose.prod.yml up -d app
# conta fundadora (ver RECOVERY.md)
docker compose -f docker-compose.prod.yml run --rm migrate node apps/api/dist/bootstrap-founder.js --email … --name … --oid … --tenant …
# ou, com login por senha: … bootstrap-founder.js --local --email … --name …  (mostra o link para definir a senha)
```

Validado nesta versão: a imagem foi construída, migrações e seed rodaram com o papel proprietário, o papel
`uon_app` foi criado e a aplicação respondeu `/health/ready`, serviu a interface (inclusive *deep links*),
recusou iniciar com o login de desenvolvimento ligado e não expôs `/api/docs`. Com o papel `uon_app`, o
banco recusou alterar a auditoria, remover triggers e usar a exceção de recuperação da fundadora.

Atrás de proxies corporativos com inspeção TLS, o build aceita a CA como *secret* opcional:
`docker build --secret id=extra_ca,src=/caminho/ca.pem --build-arg HTTPS_PROXY=… .`

### Sem Docker

```bash
npm ci && npm run build
NODE_ENV=production WEB_DIST_DIR=apps/web/dist node --env-file=.env.production apps/api/dist/migrate.js
NODE_ENV=production WEB_DIST_DIR=apps/web/dist node --env-file=.env.production apps/api/dist/server.js
```

Use um gerenciador de processos (systemd/PM2) com reinício automático. O servidor encerra com segurança em
`SIGTERM` (para a fila, fecha WebSockets e o pool do banco).

## 3. Atualização

```bash
git pull
docker compose -f docker-compose.prod.yml build
scripts/backup.sh                                     # sempre antes
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d app
```

Os usuários veem o aviso "Nova versão disponível" (PWA) e escolhem quando atualizar.

## 4. Verificações de saúde e observabilidade

- `GET /health/live` (processo) e `GET /health/ready` (banco + armazenamento). O Dockerfile já define `HEALTHCHECK`.
- Logs JSON (pino) no stdout com `reqId`; o mesmo id volta no cabeçalho `x-request-id` e aparece ao usuário
  como "código" em erros. Encaminhe para o coletor da UON (Azure Monitor, Loki, ELK…).
- Painel → Plataforma: fila de tarefas, falhas, erros de integração e eventos de segurança.

## 5. E-mail, arquivos e TURN

- E-mail: `EMAIL_ENABLED=true` + SMTP. Em desenvolvimento, `docker compose up mailpit` e `SMTP_HOST=localhost SMTP_PORT=1025`.
- Arquivos: volume `/data` (faça backup). Limites: `UPLOAD_MAX_FILE_MB`, `UPLOAD_USER_QUOTA_MB`.
- TURN: `docker compose --env-file .env.production -f docker-compose.turn.yml up -d`, liberar portas e definir
  `TURN_URLS`/`TURN_SECRET`.

## 6. Diagnóstico de erros comuns

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Servidor encerra com "Configuração inválida" | variável ausente/inválida | A mensagem indica qual; compare com `.env.example` |
| "AUTH_DEV_LOGIN_ENABLED=true não é permitido…" | login de desenvolvimento em produção | Remova a variável |
| `/health/ready` 503 `database: error` | `DATABASE_URL` errada ou papel sem permissão | Teste com `psql`; recrie `uon_app` após restaurar |
| Login Microsoft volta com "conta ainda não foi cadastrada" | usuário não pré-cadastrado e `ENTRA_AUTO_PROVISION=false` | Cadastre em Administração → Usuários |
| "excesso de grupos no token" | usuário em muitos grupos | Use grupos atribuídos ao aplicativo (ver INTEGRATIONS) |
| Faixa "Tempo real indisponível" | proxy sem upgrade de WebSocket | Habilite WebSocket em `/socket.io` |
| Chamada fica em "Conectando…" entre redes diferentes | sem TURN ou portas UDP bloqueadas | Configure coturn |
| Upload recusado (415) | tipo real do arquivo fora da lista | Ajuste `UPLOAD_ALLOWED_MIME` se a política permitir |
| 403 "Token CSRF inválido" | sessão trocada em outra aba | Recarregue a página |
| 429 | rate limit | Aguarde; ajuste `AUTH_RATE_LIMIT_PER_MINUTE` se necessário |
