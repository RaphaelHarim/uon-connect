# Segurança

Resumo dos controles implementados, como foram verificados e o que ainda depende de configuração.
Para relatar uma vulnerabilidade, contate a TI da UON Consulting (não abra issue pública).

## Controles implementados

| Área | Controle | Onde | Verificação |
| --- | --- | --- | --- |
| Autenticação corporativa | OIDC com Entra ID, *authorization code* + PKCE, `state` e `nonce` de uso único; validação de emissor, audiência, assinatura e expiração (openid-client); checagem de `tid`, `oid`, domínio e grupos | `auth/entra.ts`, `modules/auth/routes.ts` | Testes unitários das regras de *claims*; fluxo real depende do tenant (ver STATUS) |
| Identidade | Usuário identificado por `(provedor, tenant, oid)`; e-mail só associa contas pré-cadastradas no 1º login (configurável) e **nunca concede funções** | idem | Testes |
| Login por usuário e senha | Desligado por padrão (`LOCAL_AUTH_ENABLED`). Sem cadastro aberto: convite/redefinição por link de uso único (256 bits, só o hash no banco, no fragmento `#` da URL, invalidado ao emitir outro). Senha ≥ 12 caracteres, sem senhas comuns nem o e-mail (NIST 800-63B); hash scrypt (N=2¹⁶, r=8) com parâmetros por hash. Mesma mensagem e mesmo custo de hash para e-mail inexistente e senha errada. Bloqueio após `LOCAL_AUTH_MAX_ATTEMPTS` erros. 2FA TOTP (RFC 6238) com segredo cifrado (AES-256-GCM) e recusa de código reutilizado; desafio de 2FA expira em 5 min e aceita 5 tentativas. **Funções administrativas sem efeito** em sessão local sem 2FA (`LOCAL_AUTH_ADMIN_MFA_REQUIRED`). Nova senha encerra as sessões. Ninguém emite link/redefine 2FA da fundadora (aplicação **e** trigger) | `auth/local.ts`, `modules/auth/local-*.ts`, `drizzle/0002_local_auth.sql` | 19 testes de integração + E2E + instalação em contêiner |
| Login de desenvolvimento | Exige `AUTH_DEV_LOGIN_ENABLED=true` + senha ≥ 8 caracteres, só aceita contas `is_demo`; **o servidor recusa iniciar** em produção com ele ligado | `config/env.ts` | Testes + contêiner de produção |
| Sessão | Token aleatório de 256 bits em cookie `httpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção; hash no banco; expiração absoluta e por inatividade; revogação | `auth/sessions.ts` | Testes |
| CSRF | Cabeçalho `x-requested-with` obrigatório + token CSRF por sessão em toda requisição que altera estado | `app.ts` | Testes |
| Força bruta | Rate limit global e específico de login (`AUTH_RATE_LIMIT_PER_MINUTE`); falhas auditadas sem a senha | `app.ts`, `auth/routes.ts` | Testes |
| Autorização | RBAC + escopos + relação com o recurso, no servidor e em SQL; 404 em vez de 403 para recursos alheios | `authz/`, `modules/*/policy`, `service` | ~60 testes de autorização |
| Escalonamento de privilégio | Ninguém altera as próprias funções/vínculos/status; só Supreme Admin altera contas administrativas; só a fundadora designa/remove Supreme Admins | `modules/users/service.ts` | Testes |
| Conta fundadora | Proteção na aplicação **e** em triggers (não pode ser excluída, desativada, rebaixada, ter identidade trocada; no máximo uma) | `drizzle/0001_security_triggers.sql` | Testes + contêiner com papel `uon_app` |
| Auditoria | Somente inclusão (triggers bloqueiam UPDATE/DELETE/TRUNCATE), cadeia SHA-256 verificável, metadados sem segredos | idem, `modules/audit` | Testes + verificação via interface/CLI |
| Entrada | Zod em todas as rotas; Drizzle parametrizado (sem SQL concatenado com entrada do usuário); limites de tamanho | rotas | Testes |
| XSS | React escapa texto; mensagens renderizadas como texto + links seguros (`noopener noreferrer`); CSP `script-src 'self'` sem inline | `app.ts`, `Chat.tsx` | axe + revisão |
| Cabeçalhos | CSP, HSTS (produção), `X-Frame-Options`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (câmera/microfone só na própria origem) | `app.ts` | Contêiner de produção |
| CORS | Desligado por padrão (mesma origem); lista explícita em `CORS_ORIGINS` | `app.ts` | — |
| Arquivos | Tipo real por *magic bytes*; lista de permissões; bloqueio de executáveis/HTML/SVG; limite por arquivo e cota por usuário; nomes aleatórios fora da pasta pública; autorização a cada download; `Content-Disposition: attachment`, CSP `sandbox` | `modules/files` | Testes |
| Tempo real | Mesmo cookie; verificação de `Origin`; payloads validados; sinais WebRTC só entre participantes da mesma chamada | `realtime/socket.ts` | Testes |
| Segredos | Somente variáveis de ambiente; tokens do Graph cifrados (AES-256-GCM); logs com redação de cookies/tokens/senhas | `config`, `lib/crypto.ts`, `app.ts` | Revisão |
| Banco | Papel de execução sem DDL e sem UPDATE/DELETE na auditoria (`docker/postgres/app-role.sql`) | — | Verificado em contêiner |
| Notificações | Títulos sem conteúdo confidencial; e-mails só com título + link | `notifications`, `jobs/runner.ts` | Teste |
| Erros | Mensagens genéricas para 5xx com `correlationId`; detalhes só no log | `app.ts` | — |

## Dependências

- `npm audit --omit=dev`: **0 vulnerabilidades** (dependências de produção) na data desta versão.
- `npm audit` completo: 4 moderadas em ferramentas de desenvolvimento (`esbuild` antigo dentro do
  `drizzle-kit`, usado apenas para gerar migrações; não vai para produção nem expõe servidor de desenvolvimento).
- Versões fixadas por `package-lock.json`. Recomendação: Dependabot/Renovate e `npm audit` no CI.

## Pendências e riscos conhecidos

- **Antivírus de anexos**: não há varredura (ClamAV ou equivalente). A validação de tipo reduz o risco,
  mas não substitui antivírus. Recomendado antes de produção.
- **TLS**: o instalador sobe o Caddy com HTTPS (certificado público automático, CA interna ou certificado da
  empresa); com outro proxy, a TI é responsável pelo TLS (ver [INSTALAR.md](INSTALAR.md)).
- **Senhas locais** dependem de as pessoas guardarem bem a senha e o celular da 2FA. A 2FA é obrigatória só
  para administradores; tornar obrigatória para todos é uma decisão de política ainda em aberto.
  Recomendação: quando o Entra ID estiver disponível, preferi-lo (políticas de acesso condicional da Microsoft).
- **Grupos do Entra ID com excesso (overage)**: quando o token não traz os grupos, o login é **negado**
  (falha fechada). Para grandes quantidades de grupos, configurar "grupos atribuídos ao aplicativo".
- Rate limit e presença são por processo: em múltiplas instâncias, usar armazenamento compartilhado.
- Teste de intrusão independente ainda não realizado.

## Supreme Admin e recuperação

Ver [RECOVERY.md](RECOVERY.md). Não existem senhas mestras, contas ocultas ou rotas secretas.
O único caminho para alterar a conta fundadora é o procedimento formal executado com credenciais de
proprietário do banco, registrado na auditoria.
