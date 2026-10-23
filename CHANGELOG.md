# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento semântico.

## [0.2.0] — 2026-10-23

### Adicionado
- **Login por usuário e senha** (`LOCAL_AUTH_ENABLED`): sem cadastro aberto, convite e redefinição por link de
  uso único, política de senha, scrypt, bloqueio após tentativas, troca de senha, sessões encerradas ao
  redefinir.
- **Verificação em duas etapas (TOTP)** com QR code; obrigatória para funções administrativas em contas locais.
- Administração › Usuários › *Acesso por senha*: gerar convite/link, desbloquear, redefinir 2FA.
- Conta fundadora com login local (`bootstrap-founder --local`) e recuperação `--recover reset-local`;
  triggers impedem emitir link de senha da fundadora fora desse procedimento.
- **Instalador de servidor** `scripts/install.sh` (segredos, banco, papel mínimo, HTTPS com Caddy, conta
  fundadora, `--update`), restrição de acesso por IP, `scripts/backup-docker.sh`.
- Botão "Instalar o aplicativo" (PWA) e guia [docs/INSTALAR.md](docs/INSTALAR.md) (servidor, Azure, Intune).

### Alterado
- Produção recusa iniciar sem nenhum método de login configurado.
- TURN movido para `docker-compose.turn.yml`.

## [0.1.0] — 2026-10-23

Primeira versão do UON CONNECT, desenvolvida do zero.

### Adicionado
- Monorepo TypeScript (`packages/shared`, `apps/api`, `apps/web`), Docker e Docker Compose.
- Banco PostgreSQL com migrações versionadas e triggers de segurança (conta fundadora, auditoria imutável com cadeia de hash).
- Autenticação: sessões seguras, CSRF, rate limit; Microsoft Entra ID (OIDC + PKCE); login de desenvolvimento restrito a contas fictícias e bloqueado em produção.
- Autorização por funções, escopos organizacionais e relação com o recurso; Supreme Admin e conta fundadora protegida; procedimento formal de bootstrap e recuperação.
- Estrutura organizacional configurável (AVALIAÇÕES com carteiras Bradesco, Itaú e Santander; FORENSIC; PATRIMONIAIS; JURÍDICO; TI; RH).
- Chamados completos: destinos autorizados, protocolo, fluxo de status configurável, notas internas, anexos validados, acompanhantes, SLA em horas úteis, exportação.
- Dashboards pessoal, de equipe, de departamento e da plataforma, com definições explícitas de métricas.
- Comunicação em tempo real: conversas, grupos (inclusive vinculados a equipes), respostas, reações, menções, arquivos, busca, confirmação de leitura.
- Chamadas de vídeo WebRTC (até 6 participantes) com sinalização autenticada; reuniões agendadas; integração opcional com Teams e calendário do Outlook.
- Presença (manual/automática), ausências programadas ativadas pelo servidor.
- Central de notificações com preferências e e-mails sem conteúdo sigiloso.
- Painel administrativo: usuários, acesso efetivo, estrutura, configuração de chamados/SLA, auditoria, integrações, políticas.
- Interface responsiva com tema claro/escuro, PWA instalável e acessibilidade verificada com axe.
- 94 testes de unidade/integração e 13 cenários E2E; documentação técnica e executiva.

### Mudanças de repositório
- Arquivos de configuração e scripts de um MVP Electron anterior foram movidos para `legacy/` (não utilizados).
