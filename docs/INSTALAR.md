# Colocar o UON CONNECT no ar e instalar como aplicativo

Este guia tem três partes:

1. **TI:** publicar o UON CONNECT em um servidor da UON ou em uma VM no Azure.
2. **Colaboradores:** instalar o UON CONNECT no computador ou no celular.
3. **Restrição de acesso:** garantir que só a UON consiga usar.

O UON CONNECT funciona como um site com endereço próprio, por exemplo
`https://connect.uonconsulting.com.br`, mas sem cadastro aberto: só entra quem recebeu convite da
administração. Depois de instalado, ele abre em janela própria, com ícone no menu Iniciar, na barra de
tarefas ou na tela do celular, como um programa.

> **Instaladores de verdade:** além da instalação pelo navegador (abaixo), há instaladores `.exe` (Windows),
> `.dmg` (Mac) e `.apk` (Android), oferecidos na página **`/baixar`** do próprio UON CONNECT. Ver
> [INSTALADORES.md](INSTALADORES.md). **Servidor com Windows 11:** ver [SERVIDOR-WINDOWS.md](SERVIDOR-WINDOWS.md).

---

## 1. TI: publicar em um servidor

### O que é preciso

| Item | Detalhe |
| --- | --- |
| Servidor Linux | Ubuntu 22.04 ou 24.04, 2 vCPU, 4 GB de RAM e 40 GB de disco. Pode ser um servidor da UON ou uma VM no Azure (seção 1.2). |
| Docker | Docker Engine com o plugin `docker compose`. |
| Endereço | Um nome DNS apontando para o servidor, por exemplo `connect.uonconsulting.com.br`. No Azure há um endereço gratuito do tipo `uon-connect.brazilsouth.cloudapp.azure.com`. |
| Portas | 80 e 443 liberadas até o servidor (HTTPS). |
| Conta fundadora | Nome e e-mail de quem será a conta fundadora. |
| E-mail (opcional) | Um servidor SMTP. Sem ele, os convites são copiados da tela e entregues por um canal interno. |

### 1.1 Instalação com um comando

No servidor:

```bash
# Docker (script oficial). Pule esta linha se o Docker já estiver instalado.
curl -fsSL https://get.docker.com | sudo sh

# Código (repositório privado: use uma deploy key ou um token de leitura do GitHub)
git clone https://github.com/raphaelharim/uon-connect.git
cd uon-connect

# Instalação
sudo ./scripts/install.sh \
  --domain connect.uonconsulting.com.br \
  --founder-email nome@uonconsulting.com.br \
  --founder-name "Nome da Pessoa"
```

O instalador:

1. Gera `.env.production` com senhas e chaves aleatórias. O arquivo fica só no servidor, com permissão 600.
2. Constrói a imagem.
3. Sobe o PostgreSQL.
4. Cria as tabelas.
5. Cria o usuário de banco da aplicação, com privilégio mínimo.
6. Inicia o aplicativo e o proxy HTTPS (Caddy).
7. Cria a conta fundadora.

No fim, ele mostra um **link de uso único**. Por ele, a pessoa fundadora define a senha. Em seguida,
ela deve ativar a verificação em duas etapas em *Meu perfil › Senha e 2FA*.

#### Opções do instalador

| Opção | Para quê |
| --- | --- |
| `--tls auto` (padrão) | Certificado HTTPS público automático (Let's Encrypt). Exige DNS público apontando para o servidor e as portas 80 e 443 abertas para a internet. |
| `--tls internal` | Servidor só na rede interna, sem DNS público. Usa a CA interna do Caddy; **a raiz precisa ser instalada nos computadores** (seção 3), senão o app não instala. |
| `--tls files` | Usa o certificado da empresa. Coloque `cert.pem` e `key.pem` em `deploy/caddy/certs/`. |
| `--allowed-ips "…"` | Aceita acessos só dessas faixas, por exemplo o IP fixo do escritório e a VPN. Os demais recebem 403. |
| `--no-proxy` | Não sobe o Caddy, para quando a TI já tem um proxy ou load balancer. Encaminhe para `127.0.0.1:3000` com WebSocket em `/socket.io`. |
| `--skip-build` | Usa uma imagem já construída. Útil quando a rede exige CA ou proxy corporativo no build (ver [DEPLOYMENT.md](DEPLOYMENT.md)). |

#### Atualizar para uma nova versão

```bash
cd uon-connect
sudo ./scripts/backup-docker.sh /caminho/dos/backups   # sempre antes
git pull
sudo ./scripts/install.sh --update
```

#### Backup

Agende `scripts/backup-docker.sh` diariamente (exemplo de cron no próprio script) e guarde uma cópia **fora** do servidor.
Guarde também uma cópia segura de `.env.production`. Sem ela, os segredos de 2FA não podem ser lidos.
A restauração está em [RECOVERY.md](RECOVERY.md).

### 1.2 No Azure (VM)

Os comandos abaixo usam a [CLI do Azure](https://learn.microsoft.com/cli/azure/) e criam uma VM Ubuntu com
endereço gratuito. **Eles não foram executados neste ambiente.** Confira nomes, região e tamanho com a TI
e consulte o custo na calculadora do Azure antes de criar.

```bash
az group create --name rg-uon-connect --location brazilsouth

az vm create --resource-group rg-uon-connect --name vm-uon-connect \
  --image Ubuntu2404 --size Standard_B2s \
  --admin-username uonadmin --generate-ssh-keys \
  --public-ip-sku Standard --public-ip-address-dns-name uon-connect

# HTTPS aberto; SSH apenas a partir do IP da TI
az vm open-port --resource-group rg-uon-connect --name vm-uon-connect --port 80,443 --priority 1010
az network nsg rule update --resource-group rg-uon-connect --nsg-name vm-uon-connectNSG \
  --name default-allow-ssh --source-address-prefixes <IP-da-TI>/32
```

O endereço será `uon-connect.brazilsouth.cloudapp.azure.com`. Use-o em `--domain` ou crie um CNAME com o
domínio da UON. Em seguida, entre na VM (`ssh uonadmin@uon-connect.brazilsouth.cloudapp.azure.com`) e
siga a seção 1.1.

Para mais resiliência, o banco pode ir para o *Azure Database for PostgreSQL – Flexible Server*, que tem
backup automático com restauração a um ponto no tempo. Nesse caso, ajuste as URLs de banco em
`docker-compose.prod.yml` (ver [DEPLOYMENT.md](DEPLOYMENT.md)).

> O tempo real (conversas, presença e sinalização de chamadas) roda em **uma instância**. Não escale o
> serviço `app` para várias réplicas sem antes adicionar um adaptador compartilhado (ver
> [ARCHITECTURE.md](ARCHITECTURE.md)).

---

## 2. Colaboradores: instalar como aplicativo

Primeiro abra o endereço do UON CONNECT e entre uma vez com o convite recebido. Depois:

### Windows ou Mac — Microsoft Edge

1. Abra o UON CONNECT no Edge.
2. Clique no ícone **Instalar** da barra de endereço, ou use o menu **⋯ › Aplicativos › Instalar este site
   como aplicativo**. Dentro do UON CONNECT, o menu do seu nome também mostra **Instalar o aplicativo**
   quando o navegador permite.
3. Confirme. O UON CONNECT passa a abrir em janela própria e aparece no menu Iniciar. Para fixar na barra
   de tarefas, clique com o botão direito no ícone › *Fixar*.

### Windows ou Mac — Google Chrome

Ícone de instalar na barra de endereço, ou menu **⋮ › Transmitir, salvar e compartilhar › Instalar página
como app**.

### Android (Chrome)

Menu **⋮ › Instalar app**, ou **Adicionar à tela inicial**.

### iPhone e iPad (Safari)

Botão **Compartilhar › Adicionar à Tela de Início**. *Ainda não testado em Safari/iOS; ver
[TESTING.md](TESTING.md).*

### Atualizações

O aplicativo instalado se atualiza sozinho a partir do servidor. Quando houver versão nova, aparece o aviso
"Nova versão disponível". Não é preciso reinstalar.

### Instalação automática em todos os computadores (TI)

Com o Microsoft Intune ou uma Política de Grupo, a política **WebAppInstallForceList** do Edge (o Chrome
tem uma política com o mesmo nome) instala o UON CONNECT em todos os computadores gerenciados, sem ação do
usuário:

```json
[
  {
    "url": "https://connect.uonconsulting.com.br/",
    "default_launch_container": "window",
    "create_desktop_shortcut": true
  }
]
```

---

## 3. Somente para a UON

O UON CONNECT já vem fechado:

- **Sem cadastro aberto.** Uma conta só existe se a administração criar. O acesso começa por um link de
  convite de uso único, válido por 72 horas.
- **Senha forte.** Mínimo de 12 caracteres. Senhas comuns e senhas com o e-mail são recusadas. As senhas
  são guardadas com scrypt.
- **Bloqueio automático.** Após 5 erros seguidos, a conta fica bloqueada por 15 minutos.
- **Verificação em duas etapas.** Código no celular, com Microsoft Authenticator, Google Authenticator ou
  similar. Para **administradores** ela é **obrigatória**: sem ela, as funções administrativas ficam
  suspensas.
- **Desligamento.** Desativar uma conta encerra as sessões na hora.
- **Auditoria.** Tudo fica registrado e não pode ser alterado.

Camadas extras, conforme a política da UON:

- **Restringir por rede:** `--allowed-ips` no instalador, ou `UON_ALLOWED_IPS` em `.env.production`
  seguido de `sudo ./scripts/install.sh --update`. Por exemplo, só o IP do escritório e a faixa da VPN.
- **Rede interna apenas:** servidor sem IP público e `--tls internal`. Distribua a raiz da CA interna
  (`docker compose --env-file .env.production -f docker-compose.prod.yml exec caddy cat /data/caddy/pki/authorities/local/root.crt`)
  como certificado confiável via Intune/GPO. **Sem isso, o navegador mostra alerta de segurança e não deixa
  instalar como aplicativo** (o PWA exige certificado confiável). Com `--tls auto` ou com o certificado da
  empresa, não há esse passo.
- **Login Microsoft (Entra ID):** quando a TI registrar o aplicativo, o login pela conta Microsoft da UON
  pode ser ligado junto com as senhas ou no lugar delas (ver [INTEGRATIONS.md](INTEGRATIONS.md)).
