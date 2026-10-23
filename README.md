# UON CONNECT

Plataforma corporativa da **UON Consulting**: chamados internos, comunicação em tempo real,
chamadas de vídeo, presença e ausências, dashboards por equipe/departamento/carteira, administração
com auditoria imutável e proteção da conta fundadora — com autorização aplicada no servidor e no banco.

> **Estado:** versão 0.1.0, funcional e testada em ambiente de desenvolvimento/homologação.
> **Não está pronta para produção** até que as dependências externas listadas em
> [docs/STATUS.md](docs/STATUS.md) sejam configuradas (Entra ID, SMTP, TURN, servidor com TLS,
> backups agendados) e a homologação com dados reais seja concluída.

> **Colocar no ar para a UON (servidor próprio ou Azure) e instalar como aplicativo:** veja
> [docs/INSTALAR.md](docs/INSTALAR.md). Um comando (`scripts/install.sh`) sobe banco, aplicativo e HTTPS e cria a
> conta fundadora; as pessoas entram por convite, com senha e verificação em duas etapas.

## Sumário

- [Visão rápida](#visão-rápida) · [Requisitos](#requisitos) · [Instalação (desenvolvimento)](#instalação-desenvolvimento)
- [Comandos](#comandos) · [Contas de demonstração](#contas-de-demonstração) · [Estrutura do projeto](#estrutura-do-projeto)
- Documentação: [**Colocar no ar e instalar**](docs/INSTALAR.md) · [Arquitetura](docs/ARCHITECTURE.md) · [Segurança](docs/SECURITY.md) · [Banco de dados](docs/DATABASE.md) ·
  [Implantação](docs/DEPLOYMENT.md) · [Integrações](docs/INTEGRATIONS.md) · [Testes](docs/TESTING.md) ·
  [Recuperação e backup](docs/RECOVERY.md) · [Privacidade (LGPD)](docs/PRIVACY.md) · [Mobile/PWA](docs/MOBILE.md) ·
  [API](docs/API.md) · [Estado das funcionalidades](docs/STATUS.md) · [Apresentação executiva](docs/APRESENTACAO-EXECUTIVA.md) ·
  [Changelog](CHANGELOG.md)

## Visão rápida

| Camada | Tecnologia | Por quê |
| --- | --- | --- |
| Interface | React 19 + TypeScript, Vite, Tailwind CSS 4, Radix UI (acessível), TanStack Query | SPA rápida, empacotável como PWA e, no futuro, Capacitor |
| API | Fastify 5 + TypeScript, Zod, OpenAPI | Validação por esquema em todas as rotas, desempenho, documentação automática |
| Tempo real | Socket.IO (mesma sessão da API) | Mensagens, presença, notificações e sinalização WebRTC com reconexão |
| Banco | PostgreSQL 16 + Drizzle ORM (migrações SQL versionadas) | Integridade, triggers de proteção, busca textual em português |
| Vídeo | WebRTC (malha, até 6 pessoas) + TURN opcional (coturn) | Funciona sem serviço pago; Teams para reuniões maiores |
| Testes | Vitest (113 testes, banco real) + Playwright (14 cenários E2E, incl. chamada WebRTC, convite + 2FA e axe) | Fluxos críticos e regras de acesso verificados |
| Implantação | Docker (imagem única) + Docker Compose + Caddy (HTTPS) | Instalador de um comando; API serve a interface na mesma origem |

## Requisitos

- Node.js **22.12+** e npm 10
- PostgreSQL **16** (local, Docker ou serviço gerenciado)
- Opcional: Docker 24+ (serviços de apoio e imagem de produção)

## Instalação (desenvolvimento)

```bash
# 1. Dependências
npm install

# 2. Banco de dados (escolha uma opção)
docker compose up -d postgres mailpit          # PostgreSQL + caixa de e-mail local
#   ou use um PostgreSQL 16 existente e crie o banco "uon_connect"

# 3. Variáveis de ambiente
cp .env.example .env                           # ajuste DATABASE_URL e DEV_LOGIN_PASSWORD

# 4. Migrações + configuração inicial
npm run db:migrate
npm run db:seed:base                           # departamentos, carteiras, categorias, status, calendário

# 5. (Opcional) dados FICTÍCIOS de demonstração
npm run db:seed:demo -- --confirm

# 6. Executar (API em :3000, interface em :5173 com proxy para a API)
npm run dev
```

Abra <http://localhost:5173>. Sem o Entra ID configurado, a tela de login oferece apenas o
**acesso de desenvolvimento**, restrito às contas fictícias (`is_demo`) e à senha definida em
`DEV_LOGIN_PASSWORD`. Esse acesso é recusado em produção: o servidor não inicia se ele estiver ligado
com `NODE_ENV=production`.

Para a conta fundadora real, configuração do Entra ID e produção, siga
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) e [docs/RECOVERY.md](docs/RECOVERY.md).

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API (recarregamento automático) + interface Vite |
| `npm run build` | Typecheck do pacote compartilhado, bundle da API (esbuild) e build da interface/PWA |
| `npm start` | Executa a API compilada (`apps/api/dist/server.js`) |
| `npm run typecheck` / `npm run lint` | TypeScript estrito / ESLint |
| `npm test` | Testes unitários e de integração (PostgreSQL real, banco `uon_connect_test`) |
| `npm run test:e2e` | Playwright: compila a interface, recria o banco `uon_connect_e2e` e testa fluxos no navegador |
| `npm run db:migrate` | Aplica migrações versionadas (`apps/api/drizzle`) |
| `npm run db:generate` | Gera migração a partir de mudanças no esquema |
| `npm run db:seed:base` | Configuração inicial idempotente (sem pessoas) |
| `npm run db:seed:demo -- --confirm` | Dados fictícios (recusa produção e bancos com usuários reais) |
| `npm run bootstrap:founder -- …` | Cria a conta fundadora (procedimento formal, ver RECOVERY.md) |
| `npm run audit:verify` | Verifica a cadeia de hashes da auditoria |
| `scripts/backup.sh` / `scripts/restore.sh` | Backup e restauração (banco + arquivos), com verificação de integridade |

## Contas de demonstração

Criadas somente por `db:seed:demo`. Todas são **fictícias**, marcadas como demonstração na interface e
usam o domínio reservado `demo.uonconnect.local`. Senha: o valor de `DEV_LOGIN_PASSWORD`.

| Conta | Papel na demonstração |
| --- | --- |
| helena.prado@ | Conta fundadora (Supreme Admin protegida) — sem vínculos: mostra que administração ≠ acesso a conteúdo |
| rafael.nunes@ | Supreme Admin designado pela fundadora |
| otavio.reis@ | Administrador da plataforma |
| vanessa.lima@ | Auditoria |
| fernanda.lopes@ | Responsável por AVALIAÇÕES (vê Bradesco, Itaú e Santander) |
| diego.martins@ · larissa.souza@ · tiago.ribeiro@ | Coordenação das carteiras Bradesco / Itaú / Santander |
| ana.costa@ · lucas.pereira@ … | Avaliadores das carteiras |
| bruno.castro@ · carla.mendes@ | TI (responsável / atendente) |
| juliana.rocha@ · pedro.alves@ | RH (responsável / atendente) |
| sergio.moura@ · renata.farias@ · eduardo.pires@ | Responsáveis por FORENSIC, PATRIMONIAIS e JURÍDICO |

Lista completa: saída do `db:seed:demo` ou `apps/api/src/db/seed/demo.ts`.

## Estrutura do projeto

```
apps/
  api/            Fastify + Drizzle + Socket.IO
    drizzle/      migrações SQL versionadas (inclui triggers de segurança)
    src/
      auth/       sessões, Entra ID (OIDC + PKCE)
      authz/      RBAC + escopos (departamento, equipe, carteira)
      modules/    um diretório por domínio: tickets, chat, meetings, presence, users, org, …
      realtime/   Socket.IO (presença, mensagens, sinalização WebRTC)
      jobs/       fila em PostgreSQL (SKIP LOCKED) e agendador
      storage/    armazenamento privado de arquivos
      scripts/    migrate, seeds, bootstrap da fundadora, verificação da auditoria
      test/       testes de integração (banco real)
  web/            React + Vite + Tailwind (PWA)
packages/shared/  tipos, constantes e esquemas Zod compartilhados
e2e/              Playwright
docker/           scripts de banco (papel de menor privilégio)
docs/             documentação técnica e executiva
legacy/           arquivos de um MVP anterior, não utilizados (ver legacy/README.md)
```

---

PATRIMÔNIO DE UON CONSULTING · uso interno.
