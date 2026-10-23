# UON CONNECT — apresentação à gestão da UON Consulting

*Versão 0.1.0 · outubro de 2026 · documento interno*

## 1. O problema

Demandas internas circulam por e-mail, mensagens avulsas e conversas de corredor. Isso gera:
pedidos sem dono e sem prazo; falta de visão por carteira (Bradesco, Itaú, Santander) e por departamento;
comunicação espalhada entre ferramentas; e pouca rastreabilidade de quem acessou ou alterou o quê.

## 2. A proposta

**Uma plataforma própria da UON** que reúne chamados internos, comunicação, chamadas de vídeo, presença,
indicadores e administração — com regras de acesso que refletem a estrutura da empresa e são aplicadas pelo
servidor, não apenas escondendo botões.

## 3. Módulos

| Módulo | Para quê |
| --- | --- |
| Chamados | Pedidos com protocolo, responsável, prazos (SLA), histórico e anexos |
| Conversas | Mensagens individuais e em grupo, em tempo real, com arquivos e busca |
| Reuniões | Chamadas de vídeo no navegador (até 6 pessoas) e reuniões agendadas; Teams opcional |
| Presença e ausências | Status e ausências programadas com contato substituto |
| Dashboards | Indicadores por pessoa, equipe, departamento e carteira |
| Administração | Usuários, permissões, estrutura, configuração de chamados, auditoria, integrações |

## 4. Fluxo de um chamado

1. A colaboradora abre o chamado e escolhe o destino permitido (sua coordenação, o responsável do
   departamento ou uma central como TI/RH). Categorias técnicas vão direto à TI.
2. A fila responsável é notificada; a coordenação atribui um responsável.
3. Atendimento: comentários, notas internas (invisíveis ao solicitante), pedidos de informação.
4. Resolução → o solicitante confirma e encerra (ou reabre com motivo, dentro do prazo definido).
5. Tudo fica no histórico e alimenta os indicadores. Chamados de RH são confidenciais por padrão.

## 5. Organização por departamentos

AVALIAÇÕES (carteiras Bradesco, Itaú e Santander), FORENSIC, PATRIMONIAIS, JURÍDICO, TI e RH — nomes e
estrutura editáveis no painel. Novas carteiras de clientes não exigem programação.
Os responsáveis e coordenadores **ainda precisam ser cadastrados** pela UON.

## 6. Dashboards

- **Colaborador**: seus chamados, pendências, atividade recente, próximas reuniões.
- **Coordenação**: volume semanal, situação, tempo de resolução, prazos, carga por responsável.
- **Gestão de AVALIAÇÕES**: comparação entre as três carteiras e evolução mensal.
- **Plataforma**: usuários, volume, segurança, saúde das integrações (apenas números, sem conteúdo).

Cada indicador traz sua definição. Os números vêm do banco de dados, respeitam as permissões de quem vê, e a
tela avisa que **volume não mede produtividade**.

## 7. Comunicação interna

Conversas individuais e em grupo, grupos oficiais por equipe/carteira (atualizados automaticamente),
respostas, reações, menções, arquivos, confirmação de leitura e aviso claro quando algo não foi enviado.

## 8. Segurança e permissões

- Login corporativo Microsoft (quando configurado) — sem senhas próprias.
- Cada pessoa vê o que sua função e sua equipe permitem; **administrar o sistema não dá acesso** a conversas,
  chamados ou arquivos dos outros.
- **Conta fundadora** protegida inclusive no banco de dados: ninguém consegue removê-la ou rebaixá-la;
  existe um procedimento formal e auditado para casos excepcionais. Não há senhas mestras nem acessos ocultos.
- Registro de auditoria que não pode ser alterado nem apagado, com verificação de integridade.
- Desligamento bloqueia o acesso na hora e preserva o histórico.
- Princípios da LGPD aplicados (coleta mínima, acesso restrito, e-mails sem conteúdo).

## 9. Celular

Funciona no navegador do celular e pode ser **instalado como aplicativo** (PWA) no Android, iPhone e
computador. Dados corporativos não ficam guardados no aparelho. Aplicativos nas lojas (Google Play/App Store)
são uma evolução possível, que exige contas de desenvolvedor da UON.

## 10. Integrações corporativas

| Integração | Situação |
| --- | --- |
| Login Microsoft (Entra ID) | Pronta no código; aguarda registro do aplicativo pela TI |
| Calendário do Outlook | Pronta no código; aguarda consentimento |
| Reuniões no Teams | Pronta no código; aguarda consentimento |
| E-mail | Pronto no código; aguarda servidor SMTP |
| SharePoint/OneDrive | Avaliada; recomendação de apenas referenciar documentos |

Nada é exibido como "conectado" sem estar de fato configurado e verificado.

## 11. Arquitetura em alto nível

Aplicação web moderna (React) + servidor próprio (Node.js) + banco PostgreSQL, empacotados em um contêiner
Docker. Pode rodar em uma VM da UON ou em nuvem (Azure/AWS). Não depende de serviços pagos para funcionar.

## 12. O que já funciona (verificado)

Login de demonstração, permissões entre departamentos, proteção da conta fundadora, gestão de usuários e
estrutura, chamados de ponta a ponta, anexos seguros, dashboards com dados reais do banco, conversas em
tempo real, **chamada de vídeo entre dois navegadores**, presença e ausências, notificações, auditoria,
PWA, tema escuro e acessibilidade. **94 testes automatizados de servidor e 13 testes de ponta a ponta** passam;
a imagem de produção, o backup e a restauração foram testados.

## 13. O que depende da UON

Registro do aplicativo no Microsoft Entra ID; definição da conta fundadora; servidor, domínio e certificado;
SMTP; TURN para vídeo entre redes diferentes; logotipo oficial; cadastro de responsáveis e coordenadores;
políticas de SLA e de retenção de dados.

## 14. Riscos, custos e infraestrutura

| Item | Estimativa / observação |
| --- | --- |
| Servidor da aplicação | 1 VM (2 vCPU, 4 GB) para começar |
| Banco de dados | PostgreSQL gerenciado (recomendado, com backup automático) ou na mesma VM |
| TURN (vídeo entre redes) | 1 VM pequena; tráfego proporcional ao uso |
| Licenças | Nenhuma licença nova obrigatória; integrações usam o Microsoft 365 existente |
| Riscos | Login real ainda não validado no tenant; chamadas com mais de 6 pessoas pedem Teams ou infraestrutura de mídia; anexos sem antivírus; teste de intrusão e de carga pendentes |

## 15. Próximas etapas

1. TI registra o aplicativo no Entra ID e define a conta fundadora.
2. Ambiente de homologação com domínio e TLS; teste do login real, e-mail e TURN.
3. Cadastro da estrutura real (responsáveis, coordenadores) e das políticas de SLA.
4. Piloto com uma carteira de AVALIAÇÕES e a TI (2–4 semanas); ajustes.
5. Antivírus de anexos, monitoramento e teste de intrusão.
6. Lançamento gradual para os demais departamentos.
7. Evoluções: notificações push, sincronização com o diretório, aplicativo nas lojas, salas de vídeo maiores.

---

PATRIMÔNIO DE UON CONSULTING · uso interno
