# Servidor com Windows 11 (máquina física na rede da UON)

Este guia coloca o UON CONNECT num computador com Windows 11, ligado por cabo na rede da UON. Ele fica
acessível **de qualquer lugar** (escritório, casa, celular no 4G) sem abrir portas no roteador UniFi.

```
Pessoas (qualquer rede) ──HTTPS──▶ Cloudflare ──túnel de saída──▶ Windows 11 › WSL2/Ubuntu › Docker
                                                                     ├─ UON CONNECT (app)
                                                                     └─ PostgreSQL (banco)
```

O túnel é uma conexão que **sai** do servidor até a Cloudflare. Nenhuma porta fica aberta para a internet,
e o certificado HTTPS é emitido e renovado pela própria Cloudflare. Os planos gratuitos de Túnel e de
Access atendem.

> **Estado:** os comandos do Ubuntu e do Docker são os mesmos já testados em contêiner
> ([TESTING.md](TESTING.md)). O script do Windows (`scripts/windows/preparar-servidor.ps1`) teve a sintaxe
> validada, mas **não foi executado num Windows 11 real**. Os nomes dos menus do UniFi e da Cloudflare podem
> variar conforme a versão.

## O que é preciso

| Item | Observação |
| --- | --- |
| Computador com Windows 11 22H2 ou mais novo | 4 núcleos, 8 GB de RAM e SSD com 60 GB livres. Precisa ficar ligado o tempo todo; de preferência com nobreak. |
| Virtualização ligada na BIOS | Normalmente já vem ligada. Em Gerenciador de Tarefas › Desempenho › CPU deve aparecer "Virtualização: Habilitado". |
| Um domínio | Por exemplo `uonconsulting.com.br`. Se a UON já tem site ou e-mail próprio, provavelmente já tem um. Se não tem, registre no [registro.br](https://registro.br) (custo anual baixo; exige CPF ou CNPJ). |
| Conta gratuita na Cloudflare | Em [cloudflare.com](https://www.cloudflare.com), com o domínio adicionado. |

## Passo 1 — Domínio na Cloudflare

1. Crie a conta na Cloudflare e clique em **Adicionar um domínio**. Informe o domínio e escolha o plano **Free**.
2. A Cloudflare mostra dois *nameservers*. No registro.br (ou onde o domínio está registrado), em
   **DNS › Alterar servidores DNS**, troque pelos dois da Cloudflare.
3. Espere a Cloudflare indicar o domínio como **Ativo**. Pode levar de minutos a algumas horas.

> Se o domínio já atende o site ou o e-mail da UON, combine antes com quem cuida deles: a Cloudflare
> importa os registros existentes, mas confira se e-mail (MX) e site continuam iguais.

## Passo 2 — Criar o túnel

1. No painel da Cloudflare, abra **Zero Trust › Networks › Tunnels › Create a tunnel**.
2. Escolha **Cloudflared** e dê um nome, por exemplo `uon-connect`.
3. Na tela de instalação, escolha **Docker** e **copie só o token**: o texto longo depois de `--token`.
   Não rode o comando mostrado; o instalador do UON CONNECT faz isso.
4. Em **Public hostname**, preencha:
   - **Subdomain:** `connect`
   - **Domain:** o seu domínio
   - **Service:** `HTTP` e `app:3000`
5. Salve. O endereço do UON CONNECT será `https://connect.seudominio.com.br`.

## Passo 3 — IP fixo no UniFi (recomendado)

No UniFi Network, abra **Clientes**, clique no servidor e, em **Configurações**, ligue **IP fixo** com o
endereço atual. Isso evita que o endereço mude depois de um reinício.

## Passo 4 — Preparar o Windows

No servidor, copie a pasta `scripts\windows` do projeto (ou baixe `preparar-servidor.ps1`). Depois abra o
**PowerShell como Administrador** e rode:

```powershell
cd C:\caminho\da\pasta
Set-ExecutionPolicy -Scope Process Bypass
.\preparar-servidor.ps1
```

Na primeira vez, o Windows pede para reiniciar e rodar de novo. Na segunda, abre uma janela do Ubuntu
pedindo um usuário e uma senha: crie e anote. O script instala o WSL2, o Ubuntu e o Docker, desliga a
suspensão e cria uma tarefa que mantém o servidor ligado.

> A tarefa inicia quando o usuário entra no Windows. Depois de um reinício (por exemplo, por atualização),
> o UON CONNECT só volta quando alguém entrar na sessão. Para voltar sozinho, configure o login automático
> do Windows **nesta máquina dedicada** e mantenha a tela bloqueada. Em Windows Update, ajuste o horário
> ativo para reiniciar de madrugada.

## Passo 5 — Instalar o UON CONNECT

Abra o **Ubuntu** pelo menu Iniciar e rode:

```bash
# código (repositório privado: entre com a sua conta do GitHub quando pedir, ou use uma deploy key)
git clone https://github.com/raphaelharim/uon-connect.git
cd uon-connect

sudo ./scripts/install.sh \
  --domain connect.seudominio.com.br \
  --founder-email seu.email@exemplo.com.br \
  --founder-name "Seu Nome" \
  --tunnel-token 'COLE-AQUI-O-TOKEN-DO-PASSO-2'
```

No fim aparece o **link de uso único** da conta fundadora. Abra-o, defina a senha e ative a verificação em
duas etapas em *Meu perfil › Senha e 2FA*.

**Teste:** no celular, **fora do wifi** (no 4G), abra `https://connect.seudominio.com.br`.

## Passo 6 — Página de download e instaladores

1. Informe o endereço final para que eu o grave em `clients/server.json`, ou edite o arquivo:
   `{ "serverUrl": "https://connect.seudominio.com.br" }`. A cada alteração, o GitHub gera novos
   instaladores (aba **Actions › Instaladores**, seção **Artifacts**).
2. Baixe os três arquivos (Windows, Mac e Android) e envie em **Administração › Instaladores**.
3. Mande para as pessoas o link `https://connect.seudominio.com.br/baixar`. A página reconhece o aparelho e
   oferece o instalador certo. No iPhone, mostra como adicionar à Tela de Início.

Detalhes, avisos de segurança do Windows e do Mac e a assinatura do Android: [INSTALADORES.md](INSTALADORES.md).

## Camada extra (opcional): Cloudflare Access

Para que **ninguém de fora da UON** chegue nem à tela de login, crie em **Zero Trust › Access ›
Applications** uma aplicação para `connect.seudominio.com.br`, com uma política que permita só e-mails da
UON (código enviado por e-mail). O plano gratuito atende até 50 usuários. Nesse caso, libere sem Access o
caminho `/baixar` e `/api/v1/downloads`, ou envie os instaladores por outro canal. O aplicativo instalado
passa pela mesma verificação.

## Manutenção

| Tarefa | Como |
| --- | --- |
| Atualizar | No Ubuntu: `cd uon-connect && git pull && sudo ./scripts/install.sh --update` |
| Backup diário | `sudo crontab -e` e adicione `0 2 * * * cd /home/<usuário>/uon-connect && ./scripts/backup-docker.sh /home/<usuário>/backups`. Copie os backups para fora da máquina, por exemplo para o OneDrive da UON: a pasta do Ubuntu aparece no Explorador em `\\wsl$\Ubuntu-24.04\home\<usuário>`. |
| Ver se está no ar | `docker compose --env-file .env.production -f docker-compose.prod.yml ps` |
| Logs | `docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 app` |

## Sem domínio (só rede interna, não recomendado)

Dá para atender só quem está no wifi da UON, sem túnel:

```powershell
.\preparar-servidor.ps1 -AbrirPortasRedeLocal
```

```bash
sudo ./scripts/install.sh --domain connect.uon --tls internal --founder-email … --founder-name "…"
```

Crie no UniFi um registro DNS local `connect.uon` apontando para o IP do servidor (em versões recentes,
em *Configurações › Políticas*). Limitações: o certificado é interno, então cada computador e celular
precisa instalar a raiz da CA ([INSTALAR.md](INSTALAR.md) §3). Sem isso o navegador mostra alerta, e os
aplicativos de computador e Android recusam a conexão. Também não funciona fora do escritório.
