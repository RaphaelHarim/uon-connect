# UON Connect

Aplicativo desktop nativo para Windows — sistema oficial de comunicação interna da **UON Brasil**.
Substitui as conversas rápidas do Microsoft Teams por uma plataforma própria, integrada ao ambiente
corporativo e hospedada na infraestrutura da empresa.

> **Status:** MVP / prova de conceito (v0.9.0) para apresentação à diretoria.
> A camada de dados roda em memória; a arquitetura já está pronta para receber
> Microsoft Entra ID, Microsoft Graph, backend próprio e tempo real.

---

## Dois modos de execução

| Modo | Comando | O que é |
| ---- | ------- | ------- |
| **Demonstração** | `npm run dev` | Dados em memória, sem servidor. Abre sozinho, ideal para mostrar a interface. |
| **Conectado** | `npm run dev:servidor` | Fala com a API do UON Connect. Usuários conversam **de verdade**, em tempo real. |

### Teste com 2 usuários conversando

Duplo clique em **`5 - Testar com 2 usuarios.bat`**. Ele sobe o servidor e abre duas janelas do
aplicativo com sessões independentes. Entre com contas diferentes em cada uma
(`raphael.arrifano@uongroup.com` e `teste1@uongroup.com`, senha `uon@2026`),
procure um pelo outro na aba **Contatos** e converse.

Manualmente, em três terminais:

```bash
npm install
npm run server:install

npm run server        # 1) API + tempo real na porta 4000
npm run dev:servidor  # 2) aplicativo, usuário 1
npm run dev:janela2   # 3) aplicativo, usuário 2
```

### Testar entre máquinas diferentes na rede

Roteiro completo, com o que mostrar e o que fazer se algo falhar:
**[docs/DEMONSTRACAO.md](docs/DEMONSTRACAO.md)**

Resumo:

1. Na máquina servidora, rode **`7 - Liberar porta no firewall.bat`** (pede elevação). Ele cria a
   regra na porta 4000 e imprime os IPs da máquina.
2. Rode **`4 - Iniciar servidor.bat`** e deixe a janela aberta.
3. Nas outras máquinas, abra o UON Connect e, na tela de login, clique em **Alterar** ao lado do
   endereço do servidor. Informe `10.20.4.18:4000` (o IP anotado).

> O endereço do servidor é resolvido **em tempo de execução**, não no build. O mesmo instalador
> funciona em qualquer estação — e o mesmo executável servirá quando o servidor migrar para o
> Azure. Também dá para trocar depois em **Configurações → Sobre → Servidor**.

## Como executar (modo demonstração)

```bash
npm install
npm run dev        # abre a janela do Electron (Vite + Electron juntos)
```

Outros comandos:

| Comando             | O que faz                                              |
| ------------------- | ------------------------------------------------------ |
| `npm run dev:web`   | Roda só a interface no navegador (útil para demo rápida) |
| `npm run typecheck` | Verificação de tipos do TypeScript                      |
| `npm run build`     | Typecheck + build de produção em `dist/`                |
| `npm run dist`      | Gera o instalador `.exe` (NSIS, em português) em `release/` |
| `npm run dist:portable` | Gera um `.exe` portátil, sem instalação             |

### Gerar o aplicativo instalável

```bash
npm run dist
```

Saída em `release/UON-Connect-Setup-0.9.0-mvp.exe` — instalador com atalho na área de trabalho e
no menu Iniciar, entrada em "Adicionar ou remover programas" e desinstalador. A máquina de destino
**não precisa de Node.js nem de nada instalado**.

Antes de gerar, coloque o logo oficial em `build/icon.png` (512 × 512, fundo transparente) —
veja [build/LEIA-ME.md](build/LEIA-ME.md). Sem esse arquivo o build funciona, mas o executável sai
com o ícone padrão do Electron.

### Atualização automática

O aplicativo instalado se atualiza sozinho, buscando novas versões no **mesmo servidor** que já
atende o chat — nenhuma infraestrutura adicional.

Para publicar uma versão nova:

1. Aumente `"version"` no `package.json` (ex.: `0.9.0-mvp` → `0.9.1`). **O aplicativo só atualiza
   se o número for maior que o instalado.**
2. Duplo clique em **`6 - Publicar atualizacao.bat`** (ou `npm run publicar`).
3. Pronto. Os arquivos vão para `server/updates/` e o servidor os publica em `/updates`.

Nas estações, o app verifica ao abrir e baixa em segundo plano. Quando termina, mostra uma barra
discreta com **"Reiniciar agora"** — quem preferir adiar recebe a atualização ao fechar o app.
Também dá para forçar em **Configurações → Sobre → Atualizações → Verificar agora**.

Três limitações a conhecer:

- Funciona só na versão **instalada**. A portátil não se atualiza.
- Em `npm run dev` o recurso fica desligado de propósito.
- Sem certificado de assinatura, o Electron não valida a autoria do pacote. **Restrinja a escrita
  em `server/updates/` a quem publica versões** — quem escreve ali distribui código para todas as
  estações.

### Contas iniciais

O diretório nasce **enxuto**, como um produto recém-instalado: nenhum colaborador fictício,
nenhuma conversa de exemplo. Senha das três contas: **`uon@2026`**.

| Perfil            | E-mail                          | Fila que atende  | Observação                                 |
| ----------------- | ------------------------------- | ---------------- | ------------------------------------------ |
| **Administrador** | `raphael.arrifano@uongroup.com` | Todas            | Cria contas, supervisiona as três filas    |
| **Administrador** | `janete.barbosa@uongroup.com`   | Todas            | Idem, e coordena as tarefas de todas       |
| TI (compartilhada)| `informatica.br@uongroup.com`   | TI               | Conta da equipe, casada com a caixa de e-mail |
| TI / Suporte      | `matheus@uongroup.com`          | TI               | Atende a fila de TI                        |
| Colaborador       | `teste1@uongroup.com`           | —                | Abre chamado e acompanha o próprio          |
| Colaborador       | `teste2@uongroup.com`           | —                | Abre chamado e acompanha o próprio          |

### Os três papéis

| Papel             | Enxerga                                  | Pode                                                        |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------- |
| **Colaborador**   | Só os próprios chamados                  | Abrir chamado, conversar com a equipe, confirmar o encerramento |
| **Atendente**     | A fila que atende + o que ele mesmo abriu | Assumir, responder, mudar situação, escrever nota interna    |
| **Administrador** | Todas as filas                           | Tudo do atendente, mais: criar contas, mudar papéis e filas  |

O papel de administrador é o que dá acesso ao **Painel Administrativo** (o ícone de escudo na
barra lateral), onde ficam a criação de colaboradores, o bloqueio de contas e os registros de
auditoria. Ele também implica atender as três filas — não faria sentido administrar chamados que
não se enxerga.

> **Atenção à privacidade.** Administrador vê o conteúdo dos chamados de RH: folha de pagamento,
> atestados, desligamentos. Foi uma decisão consciente para que a supervisão funcione, mas vale
> revisitar se o quadro crescer — dá para separar "supervisiona" de "lê o conteúdo".

### Áreas de atendimento

O aplicativo atende **três equipes** e cada chamado nasce numa fila, deduzida da categoria
escolhida na abertura — o colaborador não precisa saber para quem está mandando:

| Fila        | Exemplos de categoria                                    |
| ----------- | -------------------------------------------------------- |
| **TI**      | Computador, rede, e-mail, acessos, senhas, software       |
| **RH**      | Férias, folha, benefícios, ponto, admissão, documentos    |
| **Compras** | Solicitação de compra, cotação, contrato, licença, reembolso |

A separação é aplicada **no servidor**, não só na tela:

- quem atende o TI não vê — nem por URL direta — um chamado de férias (`404`, não `403`: a
  resposta não confirma sequer que o chamado existe);
- quem abriu um chamado sempre continua vendo o seu, mesmo que a fila seja de outra equipe —
  o TI acompanha o pedido de compra que abriu, ainda que quem atenda seja o RH;
- **notas internas** ficam restritas a quem atende aquela fila específica;
- a Janete **coordena as tarefas** de todas as áreas: distribui trabalho para o TI, para o RH e
  para Compras. Os demais só criam tarefa dentro da própria fila.

### Como cada um entra no aplicativo

**Quem atende** cai na **Minha Visão**: blocos que respondem, sem filtrar nada, o que exige ação
hoje. As **tarefas** vêm primeiro (minhas e as da equipe), porque são o compromisso que ninguém
cobra e por isso o que mais escapa; depois os chamados — atribuídos a mim, sem responsável, abertos
por mim, resolvidos aguardando confirmação, modificados nos últimos 30 dias e monitorados. Ao lado,
a **linha do tempo** dos últimos sete dias. A fila com busca e filtros e o painel de indicadores
continuam a um clique, nas abas.

**O colaborador** vê duas gavetas e mais nada:

- **Em andamento** — os chamados que ainda pedem atenção. Cada um abre numa conversa com a equipe.
- **Encerrados** — arquivo do que já terminou, com a conversa inteira e a solução registrada.
  Serve como documentação: "como foi que resolveram isso da última vez?". Precisou de novo, é só
  reabrir.

Ele não vê fila, não vê os chamados dos colegas e nunca vê nota interna.

### Imagens dentro do chamado

Print de tela é o anexo mais comum de um helpdesk, então ele aparece **aberto na conversa**, com
ampliação ao clicar. Os demais arquivos continuam como cartão de download.

A imagem é buscada **com autenticação** e virada em blob local: a rota do anexo continua fechada e
o token nunca aparece numa URL. O servidor entrega todo anexo como `application/octet-stream` com
`nosniff` — nada enviado por um usuário é interpretado pelo navegador no contexto da aplicação. O
cliente reetiqueta o blob apenas para PNG, JPG, GIF, WEBP e BMP. **SVG fica de fora de propósito**:
é XML e pode carregar script; continua disponível para download como qualquer outro arquivo.

> Agente antigo, sem fila declarada, é tratado como agente de TI — ninguém perde acesso numa
> atualização. A migração de esquema 6 ajusta as contas existentes uma única vez.

Para colocar outra pessoa numa fila **sem mexer em código**, o administrador usa
`PATCH /api/v1/admin/users/:id/helpdesk-areas` com `{ "areas": ["rh"], "coordenaTarefas": false }`.
A tela do Painel Administrativo para isso ainda não existe — é o próximo passo natural.

> **`uon@2026` serve para entrar UMA vez.** Toda conta nasce exigindo troca de senha: o
> aplicativo não abre nenhuma outra tela antes disso, e a API recusa qualquer chamada além de
> `/auth/me`, `/auth/password` e `/auth/logout`. Contas criadas pelo Painel Administrativo
> recebem uma senha temporária **aleatória e individual**, devolvida uma única vez para o
> administrador repassar.

Os colaboradores reais devem ser cadastrados pelo **Painel Administrativo** (ou virão do
Microsoft Entra ID na fase 3). O papel no Helpdesk é atribuído por um administrador
(`PATCH /api/v1/admin/users/:id/helpdesk-role`) e **nunca** pelo próprio usuário.

> Se o servidor já rodou antes do módulo de chamados, as contas de Matheus e Janete são criadas
> automaticamente na primeira subida (uma única vez — excluí-las depois não as faz voltar).

> **Antes de colocar em produção, exclua as duas contas de teste.**

Se você já rodou o servidor antes desta mudança, apague `server/data/uon-connect.json` para que
o diretório seja recriado enxuto.

---

## O que já funciona

**Abertura e acesso**

- Splash animada: o redemoinho da marca entra girando, desacelera, o wordmark **UON** surge em
  fade, um traço luminoso cresce e a tela esmaece suavemente para o login (Esc pula a animação).
- Login por e-mail corporativo com validação de domínio (`@uongroup.com`) + botão de SSO Microsoft.
- Camada de autenticação desacoplada: `MockAuthProvider` hoje, `EntraIdAuthProvider` amanhã.

**Contatos**

- Lista com foto/iniciais, nome, cargo, departamento, status e última atividade.
- Agrupamento por departamento, busca instantânea e favoritos.
- **Filtro de país aplicado:** apenas colaboradores do Brasil. Os 3 registros de Portugal
  existentes na base de demonstração comprovam que o filtro funciona — eles não aparecem.

**Chat**

- Enviar, editar, apagar, responder e encaminhar mensagens.
- Reações com emoji, anexos (imagens, PDF, Word, Excel, PowerPoint), compartilhamento de
  localização de arquivo em rede (caminho UNC), pré-visualização de imagem e visualizador de documentos.
- Indicadores: *digitando…*, enviando / enviada / entregue / lida, presença (online, ausente,
  ocupado, offline) e último acesso.
- Agrupamento de mensagens por autor, separadores por dia, rolagem automática.

**Grupos e canais**

- Grupos, canais e departamentos (TI, RH, Financeiro, Comercial, Projetos, Infraestrutura,
  Desenvolvimento, Diretoria) com criação assistida e seleção de participantes.

**Pesquisa global** (`Ctrl + K`)

- Pessoas, conversas, mensagens, arquivos e departamentos em um único campo, com destaque do termo.

**Notificações**

- Toast nativo do Windows, notificação interna, som gerado por Web Audio e badge de não lidas
  no ícone da barra de tarefas.

**Perfil e configurações**

- Perfil com foto, recado, biografia, telefone e status.
- Tema claro/escuro/sistema, idioma (pt-BR, en-US, pt-PT), escala tipográfica, som, notificações
  e status padrão — tudo persistido.

**Painel administrativo** (visível apenas para o perfil `admin`)

- Estatísticas (colaboradores, online, mensagens do dia, conversas ativas) e gráficos.
- Cadastro, bloqueio, exclusão e troca de perfil de acesso dos colaboradores.
- Visão da estrutura organizacional (departamentos, grupos e canais).
- Trilha de auditoria com severidade, ator, alvo e IP.
- Botão de sincronização de diretório com relatório de importados × ignorados.

**Chamadas** — botões de voz, vídeo e compartilhamento de tela já posicionados na interface,
desabilitados e sinalizados como próxima fase.

---

## Publicar para a equipe

O que a pessoa recebe é **um `.exe` e um link** — a pasta cheia de `.bat` é o código-fonte, não
o que se distribui.

### Duas compilações diferentes

| Comando | Para quê | Hospedagem local |
| --- | --- | --- |
| `npm run dist:teste` | **Sua** validação antes de publicar | **Sim** — botão "Hospedar aqui" no login |
| `1 - Gerar instalador.bat` (`dist:servidor`) | O que vai para os colaboradores | **Não** |

Hospedar o servidor na própria máquina ficou de fora do aplicativo de produção. Se cada estação
pudesse hospedar, os chamados abertos ali iriam para um banco paralelo que ninguém acompanha — o
oposto do que este sistema existe para resolver.

A separação vale nos dois lados: na compilação de produção o botão não existe **e** o processo
principal recusa iniciar o servidor embutido. Esconder o botão não seria suficiente — bastaria um
cliente antigo ou uma chamada pelo console para contornar.

`dev:servidor` usa o modo de teste, então seu ambiente de desenvolvimento continua com a
hospedagem à mão.

### Os três passos

```
1 - Gerar instalador.bat        gera release/UON-Connect-Setup-<versão>.exe
6 - Publicar atualizacao.bat    copia para server/updates/ e imprime o link
                                → http://SEU-SERVIDOR:4000/baixar
```

Mande esse link no Teams. Pronto.

### A página de download

Servida pelo próprio servidor em **`/baixar`** (a raiz redireciona para lá). Ela:

- lê o `latest.yml` e sempre oferece a **versão publicada mais recente** — publicou, o link já
  aponta para a nova, sem editar nada;
- mostra **o endereço do servidor detectado pelo `Host` da requisição**, com botão de copiar. Ou
  seja, quem abrir por `http://10.20.4.18:4000/baixar` vê exatamente `http://10.20.4.18:4000`
  para digitar na primeira abertura do aplicativo — ninguém precisa decorar IP;
- explica o aviso do SmartScreen com o passo a passo do que clicar;
- lembra de deixar marcada a opção de atalho na área de trabalho.

`GET /api/v1/release` devolve o mesmo em JSON, para monitoramento.

### O instalador

O fluxo "Avançar → escolher pasta → criar ícone na área de trabalho → Concluir" já vem
configurado em `build.nsis` do `package.json`, em português:

| Opção                              | Efeito                                      |
| ---------------------------------- | ------------------------------------------- |
| `oneClick: false`                  | instalador assistido, com telas de Avançar  |
| `allowToChangeInstallationDirectory` | deixa escolher a pasta                     |
| `createDesktopShortcut`            | atalho na área de trabalho                  |
| `createStartMenuShortcut`          | atalho no menu Iniciar                      |
| `installerLanguages: pt_BR`        | instalador em português                     |

Não exige permissão de administrador (`perMachine: false`).

### O aviso do SmartScreen

Sem certificado de assinatura, o Windows mostra *"O Windows protegeu o seu computador"* e a
pessoa precisa clicar em **Mais informações → Executar assim mesmo**. Isso é esperado e a página
de download já orienta com todas as letras.

Para eliminar o aviso: distribuir por **GPO ou Intune** (a TI empurra o instalador, sem interação)
ou comprar um certificado de code signing. Detalhes e custos em
[`build/LEIA-ME.md`](build/LEIA-ME.md).

### Depois de instalado

O usuário não volta à página. A atualização automática pega a versão nova de `/updates` do mesmo
servidor que ele configurou — basta rodar `6 - Publicar atualizacao.bat` de novo, **com o número
de `version` do `package.json` aumentado**.

---

## Tarefas da equipe

Nem todo trabalho do TI vem de um pedido. Renovar certificado, revisar backup, trocar o switch,
documentar um processo — ninguém abriu chamado para isso, mas alguém precisa fazer.

**Tarefa** é esse conceito. Divide a mesma tabela dos chamados — herda conversa, histórico,
anexos, monitoramento, marcadores e relações de graça — mas difere em três pontos:

| | Chamado | Tarefa |
| --- | --- | --- |
| Origem | Pedido de um colaborador | Decisão da equipe |
| Solicitante | Sim | Não existe — os campos guardam quem **criou** |
| Prazo | Derivado da prioridade (SLA) | **Escolhido** por quem cria; sem data, uma semana |
| Vocabulário | Impressora, senha, Wi-Fi… | Infraestrutura, manutenção, projeto, segurança… |
| Indicadores | Conta no tempo médio de atendimento | **Não conta** — aparece à parte, como carga de trabalho |

Essa última linha é a que mais importa: misturar tarefa interna com chamado distorceria
justamente o indicador que mede a resposta ao colaborador. O painel mostra as duas coisas, em
blocos separados.

Tarefas são privativas de quem atende alguma fila — `/api/v1/tasks` recusa colaborador. E não
disparam e-mail: não há cliente do outro lado esperando.

Quem **coordena** (hoje a Janete) escolhe a equipe de destino e distribui tarefas para qualquer
área; os demais criam tarefa dentro da própria fila e o campo de área nem aparece. O responsável
oferecido é sempre alguém que atende a fila escolhida.

Na fila, a alternância **Chamados | Tarefas** aparece só para quem opera.

---

## O chat, e por que ele voltou

O UON Connect nasceu como mensageiro interno. Chegou a ser desligado — o argumento era que a UON
já usa o Microsoft Teams, instalado, integrado ao M365 e onde as pessoas já estão; um segundo
mensageiro competiria e perderia.

**O RH pediu de volta** e ele voltou: há conversas internas que se quer manter fora do M365. Mas o
produto não voltou a ser um mensageiro — **Chamados continua sendo a tela de entrada**, e o chat
fica logo abaixo dele na barra lateral. Conversa é apoio; o que registra trabalho é o chamado.

O módulo continua atrás de uma bandeira, que agora nasce ligada:

```
FEATURE_CHAT=false    # em server/.env, para desligar de novo
```

Com ele desligado, as rotas `/conversations` e `/messages` respondem **404** — esconder botão não
é controle de acesso. O cliente descobre o que existe em `GET /api/v1/features` e ajusta a
navegação sozinho, então ligar ou desligar **não exige gerar instalador novo**: basta reiniciar o
servidor.

---

## Banco de dados e segurança

### SQLite, não mais um arquivo JSON

A persistência era um único `.json` reescrito por inteiro a cada mensagem, com o estado todo em
memória. Agora é **SQLite** (`server/data/uon-connect.db`), com transações, índices e modo WAL —
leitores não bloqueiam quem escreve.

O driver é o **`node:sqlite`, embutido no próprio Node**: nenhuma dependência nova, nenhuma
compilação no Windows. Em troca, exige **Node 22 ou superior** — por isso o Electron subiu da 33
para a 43 (a 33 trazia Node 20, e o servidor também roda embutido no aplicativo).

**A migração é automática.** Na primeira subida, se existir um `uon-connect.json`, tudo é
importado — pessoas, conversas, mensagens com anexos e reações, chamados, notas internas,
histórico, notificações e o sequencial dos números — e o arquivo original é renomeado para
`.migrado`, nunca apagado. O relatório da importação aparece no console.

Duas garantias que passaram a ser do banco, não do código:

- **`ticket_history` é append-only por gatilho**: `UPDATE` e `DELETE` são recusados pelo próprio
  SQLite. Nem um bug futuro nem uma consulta manual reescrevem a documentação de um atendimento.
- **Números de chamado não se repetem**: índice único em `tickets.number`, e o sequencial é
  incrementado dentro da mesma transação que cria o chamado.

Backup: `store.backupTo(destino)` usa `VACUUM INTO`, que produz uma cópia consistente **com o
servidor no ar**. Copiar o `.db` com o servidor rodando, sem isso, pode gerar arquivo corrompido.

### O que mudou em segurança

| Antes                                                     | Agora                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `JWT_SECRET` com valor fixo no código                     | Servidor recusa subir com ele; gera um forte e guarda, ou usa o do ambiente |
| Todas as contas com a senha `uon@2026`                     | Senha individual; contas novas recebem temporária aleatória            |
| Sem troca de senha                                         | Troca obrigatória no 1º acesso, com política e tela própria            |
| `/auth/login` sem limite                                   | 8 tentativas por minuto, depois 15 min de bloqueio                     |
| Login dizia se o e-mail existia                            | Mensagem única — não serve mais para descobrir quem tem conta          |
| —                                                          | Cabeçalhos de segurança e `x-powered-by` desligado                     |

A política de senha exige 10 caracteres, três tipos entre minúsculas/maiúsculas/números/símbolos,
e recusa senhas que contenham o nome ou o e-mail da pessoa. Reset é feito pelo administrador em
`POST /api/v1/admin/users/:id/reset-password`, que devolve a nova temporária uma única vez.

---

## Chamados de TI (Helpdesk)

Centraliza no UON Connect todo o suporte de TI, para que nenhuma solicitação se perca em Teams,
WhatsApp ou e-mail. Fica na barra lateral, em **Chamados de TI**.

### O fluxo

```
Colaborador abre o chamado
  → recebe o número UON-000123
  → a equipe de TI é notificada (sino + e-mail para informatica.br@uongroup.com)
  → Raphael ou Matheus assume
  → atendimento acontece dentro do chamado
  → solução é registrada
  → solicitante é notificado e o chamado é encerrado
  → histórico permanece disponível para sempre
```

### Situações

`Aberto → Em análise → Em atendimento → Aguardando usuário / Aguardando terceiro → Resolvido →
Encerrado`, mais `Reaberto`. As transições são validadas no servidor: um chamado encerrado não
volta para "em análise", ele é **reaberto** — e reabrir zera o prazo.

Cada mudança entra no histórico com data, hora e autor, e aparece como uma linha na própria
conversa. **O histórico é append-only: não existe rota que apague um lançamento.**

### Perfis

| Perfil          | Enxerga                | Pode                                                                 |
| --------------- | ---------------------- | -------------------------------------------------------------------- |
| **Solicitante** | Só os próprios chamados | Abrir, responder, anexar, acompanhar, encerrar/reabrir o que é seu   |
| **Agente (TI)** | Todos os chamados       | Tudo: assumir, distribuir, mudar status/prioridade/categoria, notas internas, encerrar, reabrir |
| **Gestão**      | Todos os chamados       | Acompanhar, filtrar, consultar histórico e indicadores — sem operar  |

**Notas internas nunca chegam ao solicitante.** A regra é aplicada no backend: o servidor sequer
envia a mensagem para quem não pode vê-la, e o evento de tempo real também é filtrado.

### Modelo herdado do processo de chamados da UON

O processo oficial da empresa (documentado no *Manual de Abertura de Chamados — MantisBT UON
Solution*) trouxe quatro ideias boas para cá. O **vocabulário técnico não veio junto**, de
propósito: quem precisa de um teclado novo não deve escolher entre gravidade "trivial" e "tweak".

| Recurso | Como funciona aqui |
| ------- | ------------------ |
| **Monitorar** | Qualquer pessoa que possa ver o chamado pode segui-lo e passa a receber as atualizações. É como a gestão acompanha um caso específico sem ser a responsável. Filtro *Monitorados por mim*. |
| **Relacionar** | Ligar dois chamados como *é duplicado de*, *relacionado a* ou *depende de*. Grava-se uma linha e o lado inverso é derivado na leitura, então os dois nunca discordam. |
| **Marcadores** | Etiquetas livres para agrupar por assunto sem mexer na categoria. Normalizadas (minúsculas, sem espaço, sem repetidas), com filtro exato `?tag=` além da busca livre. |
| **Detalhes do problema** | Frequência, "consegue trabalhar de outro jeito?" e "o que você fez até o problema aparecer". |

Os três campos de detalhe **só aparecem em categorias técnicas** — computador, impressora, rede,
Wi-Fi, e-mail, Teams, sistemas e software (`CATEGORIES_WITH_DETAIL`). Em "preciso de um teclado
novo" eles seriam burocracia, e burocracia é o que faz a pessoa voltar a pedir no corredor.

O campo do contorno é o que mais muda a fila: *"estou totalmente parado"* prioriza de forma
diferente de *"consigo usar o webmail enquanto isso"*.

### Anexos

O arquivo é **gravado de verdade**, em `server/data/anexos/AAAA/MM/`, fora da pasta de instalação
(que é somente leitura e some a cada atualização). Antes, anexar guardava só nome e tamanho — o
conteúdo se perdia e ninguém nunca conseguiu abrir um anexo.

Como funciona: o arquivo sobe **antes** do chamado e vira um rascunho; o chamado cita o id. Isso
permite recusar cedo, e rascunhos abandonados são recolhidos a cada 6 horas.

| Proteção | Como |
| --- | --- |
| Tipo de arquivo | Lista de **permissão** de extensões, configurável |
| Tamanho | Corte **durante a gravação**, não pelo `Content-Length` que o cliente declara |
| Nome | O nome no disco é gerado pelo servidor; `../../etc/passwd` nunca toca o sistema de arquivos |
| Download | Mesma autorização do chamado — quem não vê o chamado recebe **404**, não 403 |
| Nota interna | Anexo em nota interna não desce para o solicitante |
| Reuso | Um anexo já usado não pode ser pendurado em outro chamado |
| Roubo | Só quem enviou o arquivo pode citá-lo |
| Execução | `Content-Disposition: attachment` + `nosniff` — um `.svg` enviado por alguém nunca é renderizado |

Anexos de **e-mail** também são salvos: o print colado numa mensagem para a caixa compartilhada
vira arquivo no chamado.

No **modo demonstração** o arquivo vive só na janela aberta — não há servidor para guardá-lo.

### Prazos (SLA)

| Prioridade | Prazo de atendimento |
| ---------- | -------------------- |
| Crítica    | 4 h                  |
| Alta       | 8 h                  |
| Média      | 24 h                 |
| Baixa      | 72 h                 |

Chamados fora do prazo aparecem marcados na fila e contam no cartão "Atrasados".

### Painéis

- **Painel do TI** — fila, chamados sem responsável, carga por atendente, categorias, atrasos.
- **Acompanhamento da gestão** — volume, tempo médio até a primeira resposta, tempo médio de
  resolução, distribuição por departamento e por colaborador.

### Integração com o e-mail

Toda comunicação é registrada em `email_logs`, **inclusive quando o envio está desligado** — o
histórico do chamado nunca depende do e-mail funcionar.

**Saída (SMTP).** Configure `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` em `server/.env`
(Microsoft 365: `smtp.office365.com:587`, com *SMTP AUTH* habilitado para a conta). São enviados:

| Evento                | Para                                      |
| --------------------- | ----------------------------------------- |
| Chamado aberto        | `informatica.br@uongroup.com` + confirmação ao solicitante |
| Nova resposta pública | Solicitante (ou a caixa, se veio dele)    |
| Mudança de situação   | Solicitante + caixa compartilhada         |
| Resolvido / encerrado | Solicitante + caixa, com a solução registrada |

**Entrada (IMAP).** Configure `IMAP_HOST`, `IMAP_USER` e `IMAP_PASS`. A cada 60 s a caixa é
varrida e:

- assunto com `[UON-000123]` → vira **resposta** naquele chamado;
- qualquer outro e-mail de um colaborador do diretório → abre um **chamado novo**, com categoria
  e prioridade sugeridas pelo texto;
- respostas automáticas e remetentes fora do diretório são ignorados (e registrados no log).

Assim, quem escreve direto para a informática entra na mesma fila de quem usa o aplicativo.

> As bibliotecas de e-mail (`nodemailer`, `imapflow`, `mailparser`) são carregadas sob demanda.
> Se não estiverem instaladas, o servidor sobe normalmente e o Helpdesk continua inteiro — só não
> dispara nem lê mensagens. Rode `npm --prefix server install` para habilitar.

---

## Identidade visual

Toda a paleta e a tipografia foram extraídas do CSS do site institucional
(`uongroup.com.br → Portals/_default/Skins/Uon_Consulting/skin.css`):

| Token              | Valor     | Origem no site                         |
| ------------------ | --------- | -------------------------------------- |
| `--uon-navy-800`   | `#002D56` | header, títulos, rodapé — cor primária |
| `--uon-navy-700`   | `#033E60` | variações do navy                      |
| `--uon-blue-600`   | `#056BAD` | links e realces                        |
| `--uon-cyan-500`   | `#0092BF` | cor de destaque                        |
| `--uon-cyan-300`   | `#3B96B6` | apoio                                  |
| `--uon-cyan-100`   | `#CEE3EC` | fundos claros                          |
| Tipografia títulos | Raleway   | `font-family:Raleway` no skin          |
| Tipografia texto   | Source Sans Pro | `font-family:"Source Sans Pro"`  |

Tudo vive em `src/styles/tokens.css` — **ponto único de troca de marca**.

### O símbolo — três lâminas inscritas num círculo

A geometria em `src/ui/components/Logo.tsx` foi **extraída da logo oficial**, não estimada: a
imagem da marca foi amostrada em coordenadas polares e o perfil mostrou, para cada ângulo, uma
única faixa branca cujo raio interno e externo crescem juntos. Cada lâmina é, portanto, uma fita
em espiral que nasce grossa perto do centro, desenrola para fora afinando, encosta na borda e
termina em ponta — e o contorno do conjunto é uma circunferência perfeita. Três cópias a 120°.

Os parâmetros (`SPAN`, `RI_START`, `RO_START`, `TAPER`…) estão no topo do arquivo e foram
ajustados comparando a reconstrução com a arte original lado a lado.

**Cor.** A marca é branca, como na logo oficial. Sobre fundo claro (login, tela vazia do chat,
carregamento) use `<UonSwirl plate />`: um disco navy entra atrás do símbolo — que é exatamente
como a marca aparece na papelaria da UON.

**Animação de abertura.** Os três braços são elementos independentes (`.uonswirl__arm`, com a
variável `--arm` marcando a ordem). Eles entram girando, um a um, e se encaixam formando a marca;
o conjunto então assenta com um giro de **120°** — como a forma tem simetria de ordem 3, o giro
acontece e a logo final fica idêntica à oficial. Em seguida surge `UON`, depois `CONSULTING`
(a assinatura da empresa) e, por fim, `CONSULTING` dá lugar a `CONNECT` antes de a tela abrir.

> **Para usar o arquivo oficial da marca**: substitua apenas o conteúdo de `<UonSwirl>` pelo SVG
> oficial, mantendo as classes `uonswirl` e `uonswirl__arm` nas três lâminas. A animação continua
> funcionando sem nenhuma outra alteração no projeto.

---

## Estrutura do projeto

```
electron/            processo main + preload (CommonJS, sem etapa de build)
server/              API REST + Socket.IO (Node, sem dependência nativa)
  src/
    index.js         bootstrap do Express + Socket.IO
    config.js        variáveis de ambiente
    store.js         persistência em JSON (ponto de troca para PostgreSQL)
    seed.js          carga inicial
    auth.js          scrypt + JWT + middlewares
    routes.js        rotas /api/v1
    realtime.js      salas, presença e digitando
    db/              BANCO DE DADOS (SQLite via node:sqlite)
      connection.js  abertura, PRAGMAs (WAL), transações
      schema.js      DDL, índices e gatilhos de append-only
      importJson.js  migração única do arquivo JSON antigo
    helpdesk/        CHAMADOS DE TI
      catalog.js     status, prioridades, categorias, SLA e permissões
      tickets.js     persistência dos chamados (namespace store.tickets)
      routes.js      rotas /api/v1/tickets + notificador
      email.js       envio SMTP + templates + email_logs
      mailIngest.js  varredura IMAP: e-mail → chamado
src/
  config.ts          modo (mock/http), endereços e filtro de país
  core/              DOMÍNIO — entidades e portas (sem React, sem HTTP)
    entities.ts
    tickets.ts       domínio do Helpdesk (espelho de server/helpdesk/catalog.js)
    ports.ts
  infra/             ADAPTADORES — implementações intercambiáveis
    auth/            MockAuthProvider · EntraIdAuthProvider
    graph/           GraphUserDirectory (Microsoft Graph, filtro BR)
    http/            HttpAuthProvider · HttpUserDirectory · HttpChatRepository ·
                     HttpAdminService · HttpHelpdeskRepository
    realtime/        SocketRealtimeGateway
    mock/            base em memória, seed e adapters da demonstração
  app/               container (DI), store, helpdesk, i18n, som
  platform/          ponte tipada com o Electron
  ui/
    screens/helpdesk/  fila, detalhe do chamado, abertura e painéis
    ...                demais componentes, painéis e telas
  styles/            tokens de marca + folha de estilo
```

O arquivo de dados do servidor fica em `server/data/uon-connect.json`. Apagar esse arquivo
recomeça do zero com a carga inicial.

Detalhes de arquitetura, modelo de dados e plano de migração: **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)**.

---

## Atalhos

| Atalho          | Ação                          |
| --------------- | ----------------------------- |
| `Ctrl + K`      | Pesquisa global               |
| `Ctrl + ,`      | Configurações                 |
| `Enter`         | Enviar mensagem               |
| `Shift + Enter` | Quebra de linha               |
| `Esc`           | Fechar modal / cancelar resposta / pular splash |

---

Desenvolvido pela equipe de Tecnologia da Informação — UON Brasil. Uso interno.
