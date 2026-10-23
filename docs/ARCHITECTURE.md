# Arquitetura

## Decisões principais

| Decisão | Escolha | Alternativas consideradas e motivo |
| --- | --- | --- |
| Formato da aplicação | **SPA React + API Fastify separadas, servidas na mesma origem** em produção | Next.js foi avaliado: WebSockets exigiriam servidor customizado e a SPA estática é a base mais simples para PWA e Capacitor. Mesma origem elimina CORS e simplifica cookies. |
| Linguagem | TypeScript estrito em todo o monorepo | Tipos compartilhados entre API e interface (`packages/shared`). |
| Banco | PostgreSQL 16 | Transações, triggers para regras de integridade, busca textual em português, `SKIP LOCKED` para fila. |
| ORM | **Drizzle** | Puro JavaScript (sem binário de engine, que falharia atrás de proxies corporativos), migrações SQL legíveis e editáveis — necessárias para os triggers de segurança. Prisma foi descartado por isso. |
| Validação | Zod (esquemas compartilhados) + `fastify-type-provider-zod` | Todo corpo, query e parâmetro é validado no servidor; o mesmo esquema gera o OpenAPI. |
| Sessão | Cookie `httpOnly` com token opaco; sessão guardada (hash SHA-256) no banco | JWT em localStorage foi descartado: revogação imediata (desligamento, troca de função) exige estado no servidor. |
| Tempo real | Socket.IO | Reconexão, fallback de transporte, salas por usuário. Para várias instâncias: adaptador Redis (não incluído). |
| Vídeo | WebRTC em malha + TURN opcional | Sem custo de SFU; limite configurável (6). Reuniões maiores: Teams (integração opcional) ou um SFU (LiveKit/mediasoup) em fase futura. |
| Fila de tarefas | Tabela `jobs` no PostgreSQL com `FOR UPDATE SKIP LOCKED` | Sem Redis/RabbitMQ para começar; suficiente para e-mails e tarefas periódicas. |
| Arquivos | Disco local privado (fora da pasta pública) atrás de rota autorizada | S3/SharePoint avaliados em [INTEGRATIONS.md](INTEGRATIONS.md); interface `Storage` permite trocar o driver. |
| Gráficos | SVG próprio | Bibliotecas de gráficos adicionariam ~100 KB; os gráficos têm tooltip, legenda, rótulos diretos e visão em tabela. |

## Visão em camadas

```
 Navegador (React/PWA) ──HTTP /api/v1 (cookie + CSRF)──▶ Fastify ──▶ serviços de domínio ──▶ PostgreSQL
        │                                                  │                    │
        └──────────── WebSocket /socket.io ───────────────┘                    ├─▶ armazenamento de arquivos
                       (mesma sessão; salas user:<id>, call:<id>)               ├─▶ fila jobs → SMTP
                                                                                └─▶ Microsoft Graph (opcional)
```

- **Rotas** (`modules/*/routes.ts`) só validam entrada e chamam serviços.
- **Serviços** (`modules/*/service.ts`) concentram regras de negócio e **autorização por recurso**.
- **Políticas** (`modules/tickets/policy.ts`, `chat/service.ts#canContact`, `files/routes.ts#canReadFile`)
  decidem o acesso a cada objeto. A mesma regra existe em duas formas: função TypeScript (um recurso) e
  cláusula SQL (listas, contagens, exportações, dashboards) — e os testes verificam que coincidem.
- **Persistência** (`db/schema`) e **triggers** (`drizzle/0001_security_triggers.sql`) repetem as regras
  críticas (conta fundadora, auditoria) para que um erro de aplicação não as contorne.

## Modelo de autorização

1. **Funções de plataforma (RBAC)** — `supreme_admin`, `platform_admin`, `auditor` → permissões
   administrativas (`authz/permissions.ts`). **Nenhuma função dá acesso a conteúdo** de chamados,
   conversas ou arquivos.
2. **Escopos organizacionais** — derivados dos vínculos (`authz/context.ts`):
   - responsável por departamento (`head`) → supervisiona todas as equipes do departamento;
   - atendente (`agent`) → trabalha a central de atendimento do departamento (TI, RH…);
   - coordenador de equipe/carteira → supervisiona a equipe.
3. **Relação com o recurso** — solicitante, responsável, acompanhante, membro da conversa, participante
   da reunião.

O contexto (`AuthContext`) é recarregado **a cada requisição**: mudanças de função ou desativação valem
imediatamente; desativação também encerra sessões e derruba conexões em tempo real.

### Chamados

| Quem | Vê | Age |
| --- | --- | --- |
| Solicitante | seus chamados | comentar, cancelar, confirmar/encerrar, reabrir (com motivo, dentro do prazo) |
| Fila: coordenação da equipe (destino "equipe"), responsável (destino "responsável"), atendentes da central (destino "central") | chamados da fila, incluindo notas internas | triagem, atribuição, prioridade, transições de atendimento |
| Responsável atribuído | o chamado | como a fila |
| Supervisão (coordenação/responsável da equipe ou departamento **do solicitante**) | chamados **não confidenciais** da sua área | somente leitura |
| Acompanhante (compartilhado) | o chamado (sem notas internas) | comentar |
| Administradores | **nada** por serem administradores | — |

Transições de status vêm da tabela `ticket_status_transitions` (configurável), separadas por papel
(`requester`/`handler`) e com motivo obrigatório quando configurado.

### Conversas

Somente membros atuais leem e escrevem (404 para os demais, inclusive administradores). Quem pode iniciar
conversa com quem segue a política `chatDirectPolicy` (empresa toda ou mesmo departamento). Membros
veem o histórico a partir de quando entraram. Grupos vinculados a equipe acompanham a composição da equipe.

## Tempo real

- Autenticação do socket pelo mesmo cookie da API + verificação de `Origin` (proteção contra
  *cross-site WebSocket hijacking*).
- O servidor só envia eventos para salas `user:<id>`; a interface usa os eventos apenas como **sinal** e
  busca os dados via HTTP. Se o tempo real cair, nada se perde: a interface mostra o aviso e oferece atualizar.
- Mensagens são enviadas por HTTP com `clientNonce` (idempotente): reenvio após falha não duplica.
  A interface mostra "enviando", "enviada", "lida" e "não enviada — tentar de novo".

## Chamadas de vídeo

- Sinalização via Socket.IO (`call:join`, `call:signal`, `call:media`, `call:leave`); o servidor só repassa
  sinais entre sockets que estão na mesma sala **e** são participantes verificados da reunião.
- Malha (cada participante conecta-se aos demais); quem entra cria as ofertas (sem colisões).
- ICE: STUN/TURN de variáveis de ambiente; credenciais TURN temporárias (HMAC, padrão coturn
  `use-auth-secret`).
- Reconexão: queda do socket → reentrada automática e reconstrução das conexões; ICE `failed` → `restartIce`.

## Tarefas em segundo plano

`jobs/runner.ts`: worker da fila (a cada 3 s) e agendador (a cada 30 s, protegido por *advisory lock* — só
uma instância executa). Tarefas: ativação/encerramento de ausências, encerramento automático de
chamados resolvidos, alertas de SLA, expiração de status manual, limpeza de sessões e fluxos OIDC,
reprocessamento de tarefas travadas.

## Escalabilidade

Uma instância atende confortavelmente uma empresa do porte da UON. Para várias instâncias:
1. adaptador Redis do Socket.IO (presença e salas são por processo hoje);
2. armazenamento de arquivos compartilhado (S3/Blob) em vez de disco local;
3. rate limit com armazenamento compartilhado;
4. SFU para chamadas com mais participantes.
A fila e o agendador já suportam múltiplas instâncias.

## Organização do código

Ver árvore no [README](../README.md#estrutura-do-projeto). Convenções:
- uma pasta por domínio em `apps/api/src/modules`;
- nenhuma consulta SQL em componentes da interface; nenhuma regra de permissão só no frontend
  (a interface esconde botões por conveniência; o servidor decide);
- erros padronizados `{ error: { code, message, correlationId } }`; o `correlationId` aparece para o
  usuário e nos logs.
