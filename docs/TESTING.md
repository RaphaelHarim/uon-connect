# Testes

## Como executar

```bash
npm test             # unitários + integração (Vitest) contra PostgreSQL real
npm run test:e2e     # Playwright (compila a interface, recria o banco de E2E, sobe a API servindo o build)
npm run typecheck && npm run lint
```

Bancos usados (recriados automaticamente a partir das migrações; nunca o banco de desenvolvimento):
`uon_connect_test` (Vitest, `TEST_DATABASE_URL`) e `uon_connect_e2e` (Playwright, `E2E_DATABASE_URL`).
O `docker-compose.yml` de desenvolvimento cria ambos.

## Resultado nesta versão (executado em 23/10/2026)

| Conjunto | Resultado |
| --- | --- |
| `packages/shared` (presença) | 3/3 ✔ |
| API — integração e unidade | **91/91 ✔** em 6 arquivos |
| E2E Playwright (Chromium desktop + Pixel 7) | **13/13 ✔** |
| TypeScript estrito (shared, api, web) | ✔ sem erros |
| ESLint | ✔ sem erros |
| Build de produção (API + web/PWA) | ✔ |
| Imagem Docker + contêiner de produção | ✔ (ver DEPLOYMENT) |
| Backup e restauração | ✔ (ver RECOVERY) |
| `npm audit --omit=dev` | 0 vulnerabilidades |

## Cobertura por requisito

### Autenticação e autorização (`apps/api/src/test/auth.test.ts`, `founder.test.ts`, `tickets.test.ts`, `chat.test.ts`)

- Usuário não autenticado recebe 401 em todos os recursos privados.
- Login de desenvolvimento: só contas fictícias, senha correta; falhas auditadas sem a senha; rate limit (429).
- CSRF: requisições sem cabeçalho ou com token errado → 403. Logout revoga a sessão.
- Configuração: produção recusa login de desenvolvimento; Entra ID parcial é rejeitado; produção exige HTTPS.
- Regras de *claims* do Entra ID (tenant, oid, domínio, grupos, *overage*).
- Colaborador de outra equipe não vê o chamado (404); coordenador só vê suas equipes; responsável por
  AVALIAÇÕES vê Bradesco, Itaú e Santander; responsáveis de outros departamentos não veem AVALIAÇÕES;
  TI vê só o que é técnico/atribuído; RH vê o chamado confidencial de RH, mas coordenação e responsável do
  solicitante não; RH não vê chamados fora da sua competência; administradores e Supreme Admins não veem
  conteúdo por função; destinos não autorizados são recusados; listagens conferidas item a item com o detalhe.
- Usuário comum não altera permissões (próprias ou de terceiros); administrador não altera a si mesmo;
  administrador da plataforma não concede funções nem altera contas privilegiadas.
- Conta fundadora: administrador e outro Supreme Admin não desativam, rebaixam, editam nem encerram sessões;
  operações em lote a ignoram e processam as demais; a própria fundadora não se rebaixa; tentativas negadas
  ficam na auditoria; **triggers do banco** bloqueiam UPDATE/DELETE diretos, remoção de função, troca de
  identidade e segunda fundadora.
- Só a fundadora designa/remove Supreme Admins. Desativação encerra sessões na hora e preserva histórico.
- Auditoria: UPDATE/DELETE/TRUNCATE bloqueados; cadeia de hash íntegra; leitura só para auditoria/Supreme Admin.
- Exportações e downloads respeitam permissões; conversas invisíveis a não membros (inclusive administradores).

### Chamados

Abertura, protocolo, roteamento por categoria, notificação da fila, atribuição (somente elegíveis), triagem
automática, notas internas ocultas ao solicitante, "aguardando solicitante" → resposta → "em andamento",
resolução, encerramento, bloqueio de comentário após encerrar, reabertura com motivo obrigatório, histórico,
acompanhantes, anexos (PDF/PNG/TXT aceitos; executável, arquivo disfarçado e SVG recusados; limite de tamanho;
upload por não participante recusado; anexo de nota interna oculto), filtros, CSV, indicadores do departamento
conferidos contra o banco, SLA "não configurado" quando não há política.

### Comunicação, presença e reuniões

Conversa única por par, entrega em tempo real via Socket.IO, histórico, idempotência de envio, respostas,
reações, edição/remoção só pelo autor, busca restrita, compartilhamento de arquivos (só membros; arquivo não
reutilizável), não lidas e leitura, grupos (papéis, saída, promoção automática de administrador), grupos
vinculados a equipes, menções, política de contato por departamento, rejeição de sockets sem sessão ou de
outra origem, presença e digitação, status manual, ausência ativada pelo servidor, visibilidade da ausência,
substituto sem acesso adicional, chamadas: convite em tempo real, não participante recusado, sinalização
WebRTC repassada só dentro da chamada, encerramento pelo organizador, grupo a partir dos participantes, limite
de participantes, Teams recusado sem configuração.

### Integrações e tarefas

E-mail pela fila sem conteúdo sigiloso; tarefas agendadas (encerramento automático de resolvidos e alerta de SLA único); cliente Graph com token cifrado (sucesso, 403, sem conexão); painel de
integrações mostrando "não configurada".

### E2E (`e2e/`)

1. Login/logout e redirecionamento; senha incorreta.
2. Fluxo completo de chamado entre três pessoas com anexo, e bloqueio para pessoa de outra carteira.
3. Mensagem em tempo real entre dois navegadores, confirmação de leitura e reação; criação de grupo.
4. **Chamada de vídeo real** entre dois navegadores (câmera/microfone simulados): ambos os lados em
   `connected`, vídeo remoto recebendo quadros, sinalização de microfone desligado, encerramento para todos.
5. Permissões na interface e por requisição forjada à API (conta fundadora protegida).
6. Acessibilidade com axe (WCAG 2 A/AA) em 10 telas, tema claro e escuro — sem violações sérias/críticas.
7. Celular (Pixel 7): navegação inferior, menu, sem rolagem horizontal; PWA (manifesto e service worker).

## O que não foi testado (e o risco)

| Item | Motivo | Risco/mitigação |
| --- | --- | --- |
| Login real no Entra ID, Graph e Teams | sem tenant/credenciais | Testar em homologação com o registro do aplicativo da UON antes de produção |
| SMTP real | sem servidor de e-mail | Testar com Mailpit e depois com o SMTP corporativo |
| Chamadas atravessando NAT/firewall com TURN | sem infraestrutura | Testar entre redes diferentes após subir o coturn |
| Safari/iOS e Firefox | só Chromium disponível | Executar Playwright com WebKit/Firefox no CI; validar a PWA em iPhone real |
| Carga/desempenho | fora do escopo desta etapa | Teste de carga (k6) antes do lançamento amplo |
| Teste de intrusão | requer equipe independente | Contratar antes de expor à internet |
