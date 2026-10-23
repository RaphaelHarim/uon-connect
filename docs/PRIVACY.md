# Privacidade e LGPD

Documento técnico de apoio ao encarregado (DPO) e ao jurídico da UON Consulting. As bases legais, prazos e
políticas finais **devem ser aprovados pela UON**; abaixo estão os padrões adotados pela plataforma.

## Dados tratados

| Categoria | Dados | Finalidade | Quem acessa |
| --- | --- | --- | --- |
| Identificação | nome, e-mail corporativo, cargo, foto (opcional), identificador do Entra ID | autenticação e identificação interna | todos os colaboradores (nome, cargo, foto); administração (dados da conta) |
| Contato | telefone (opcional) | contato entre colegas | colegas do mesmo departamento e administradores de usuários |
| Organização | departamento, equipe, carteira, papéis | permissões e roteamento de chamados | colaboradores (estrutura); administração |
| Chamados | descrição, comentários, anexos, histórico | atendimento de demandas internas | solicitante, fila responsável, supervisão (exceto confidenciais), acompanhantes |
| Comunicação | mensagens, reações, arquivos | comunicação de trabalho | **somente membros** da conversa |
| Presença | status manual, última conexão, ausências | disponibilidade | colegas (status); detalhes da ausência conforme a visibilidade escolhida |
| Sessões | IP, navegador, horários | segurança | o próprio usuário; segurança/auditoria |
| Auditoria | ações relevantes, autor, recurso, IP, correlação | segurança e responsabilização | Auditoria e Supreme Admin |
| Calendário Outlook (se habilitado) | eventos do próprio usuário | exibição sob demanda | somente o próprio usuário (não é armazenado) |

Não são coletados: localização, conteúdo de tela, gravações de chamadas (chamadas não são gravadas), dados
sensíveis do art. 5º, II, salvo o que o próprio colaborador escrever em um chamado de RH — por isso a
categoria RH é **confidencial por padrão**.

## Princípios aplicados

- **Necessidade**: presença automática só indica conexão; a plataforma não mede atividade nem "tempo trabalhado".
  Dashboards mostram volume e tempo de atendimento com aviso de que não medem produtividade.
- **Acesso mínimo**: administradores técnicos não leem conversas, chamados ou arquivos por causa da função.
- **Transparência**: cada pessoa vê suas sessões e pode encerrá-las; pode ajustar notificações e visibilidade
  da ausência.
- **Segurança**: ver [SECURITY.md](SECURITY.md).
- **E-mails**: só título e link — nada de conteúdo.

## Desativação e desligamento

Desativar/desligar: bloqueia o login imediatamente, encerra sessões e conexões em tempo real e mantém o
histórico (chamados, mensagens e auditoria não são apagados, por exigência de rastreabilidade). O nome continua
aparecendo nos registros históricos.

## Direitos do titular (correção, acesso, eliminação)

- **Correção**: nome e telefone pelo próprio usuário (Meu perfil); demais dados pela administração.
- **Acesso/portabilidade**: a administração pode extrair os dados do titular a partir do banco
  (procedimento a formalizar com o DPO).
- **Eliminação**: pode conflitar com a guarda de registros e auditoria. Recomenda-se anonimização (substituir
  nome/e-mail/foto/telefone por um identificador) após o prazo de retenção, preservando o histórico. A rotina de
  anonimização **não está implementada** — depende da política aprovada.

## Retenção (proposta a aprovar)

| Dado | Prazo sugerido |
| --- | --- |
| Sessões expiradas/revogadas | 90 dias (automático) |
| Fluxos de login OIDC | 10 minutos (automático) |
| Notificações lidas | 12 meses (rotina a implementar) |
| Chamados e anexos | enquanto houver finalidade; revisão anual |
| Mensagens | conforme política de comunicação da UON |
| Auditoria | ≥ 5 anos |
| Backups | 30 dias |

## Integrações e transferências

- Microsoft Entra ID/Graph (Microsoft, conforme contrato M365 da UON): autenticação; calendário e Teams só se habilitados.
- SMTP configurado pela UON.
- Nenhum outro serviço externo é chamado. Fontes externas (fontes tipográficas, CDNs) não são usadas: tudo é
  servido pela própria plataforma.

## Responsabilidades dos administradores

Conceder funções e vínculos estritamente necessários; revisar periodicamente o "acesso efetivo" de contas
administrativas e coordenadores; não usar acesso técnico ao banco para ler conteúdo; registrar aprovações de
procedimentos excepcionais (recuperação da conta fundadora); responder a incidentes conforme o plano da UON.
