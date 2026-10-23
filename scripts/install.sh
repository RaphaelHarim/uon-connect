#!/usr/bin/env bash
# UON CONNECT — instalação e atualização em um servidor Linux com Docker (servidor da UON ou VM no Azure).
#
# Primeira instalação (gera segredos, sobe banco + app + HTTPS e cria a conta fundadora):
#   sudo ./scripts/install.sh --domain connect.exemplo.com.br \
#        --founder-email pessoa@exemplo.com.br --founder-name "Nome da Pessoa" [--tls auto|internal|files] \
#        [--allowed-ips "200.1.2.3/32 10.0.0.0/8"] [--no-proxy] [--skip-build]
#
# --skip-build usa uma imagem já construída (variável UON_IMAGE, padrão uon-connect:latest), por exemplo
# quando a rede exige proxy/CA corporativa no build (veja docs/DEPLOYMENT.md) ou a imagem vem de um registro.
#
# Atualização (depois de "git pull"): sudo ./scripts/install.sh --update
#
# O que NÃO faz: não cria DNS, não abre firewall da nuvem e não envia nada para fora do servidor.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=.env.production
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

DOMAIN="" FOUNDER_EMAIL="" FOUNDER_NAME="" TLS_MODE="auto" ALLOWED_IPS="" UPDATE=0 PROXY=1 BUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --founder-email) FOUNDER_EMAIL="$2"; shift 2 ;;
    --founder-name) FOUNDER_NAME="$2"; shift 2 ;;
    --tls) TLS_MODE="$2"; shift 2 ;;
    --allowed-ips) ALLOWED_IPS="$2"; shift 2 ;;
    --no-proxy) PROXY=0; shift ;;
    --skip-build) BUILD=0; shift ;;
    --update) UPDATE=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\nErro: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker não encontrado. Instale o Docker Engine: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "O plugin 'docker compose' não está instalado."

profiles() {
  if grep -q '^UON_PROXY=1' "$ENV_FILE"; then echo "--profile https"; fi
}

wait_ready() {
  say "Aguardando o aplicativo responder…"
  for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      echo "Pronto."; return 0
    fi
    sleep 2
  done
  "${COMPOSE[@]}" logs --tail=50 app
  die "O aplicativo não ficou pronto. Veja os logs acima."
}

# ---------------------------------------------------------------- update
if [[ $UPDATE -eq 1 ]]; then
  [[ -f $ENV_FILE ]] || die "$ENV_FILE não existe. Faça a primeira instalação antes."
  if [[ $BUILD -eq 1 ]]; then
    say "Construindo a nova versão…"
    "${COMPOSE[@]}" build app migrate
  fi
  say "Aplicando migrações do banco…"
  "${COMPOSE[@]}" run --rm migrate
  # shellcheck disable=SC2046
  "${COMPOSE[@]}" $(profiles) up -d
  wait_ready
  say "Atualização concluída."
  exit 0
fi

# ---------------------------------------------------------------- first install
[[ -n $DOMAIN ]] || die "Informe --domain (ex.: connect.exemplo.com.br)."
[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "Domínio inválido: $DOMAIN"
[[ -n $FOUNDER_EMAIL && -n $FOUNDER_NAME ]] || die "Informe --founder-email e --founder-name (a conta fundadora)."
[[ $TLS_MODE =~ ^(auto|internal|files)$ ]] || die "--tls deve ser auto, internal ou files."
if [[ $TLS_MODE == files && ( ! -f deploy/caddy/certs/cert.pem || ! -f deploy/caddy/certs/key.pem ) ]]; then
  die "Com --tls files, coloque cert.pem e key.pem em deploy/caddy/certs/."
fi
[[ -f $ENV_FILE ]] && die "$ENV_FILE já existe: a instalação já foi feita. Para atualizar use --update."

secret() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40; }
say "Gerando $ENV_FILE com segredos novos (fica só neste servidor)…"
umask 077
cat > "$ENV_FILE" <<EOF
# Gerado por scripts/install.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). Contém segredos: não versione, não envie por e-mail.
NODE_ENV=production
APP_BASE_URL=https://$DOMAIN
TRUST_PROXY=true
LOG_LEVEL=info

POSTGRES_OWNER_USER=uon_owner
POSTGRES_OWNER_PASSWORD=$(secret)
POSTGRES_APP_USER=uon_app
POSTGRES_APP_PASSWORD=$(secret)

# Login com usuário e senha (convites gerados pela administração).
LOCAL_AUTH_ENABLED=true
LOCAL_AUTH_ADMIN_MFA_REQUIRED=true
TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)

# E-mail (opcional): preencha para enviar convites e notificações por e-mail.
EMAIL_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Proxy HTTPS (Caddy)
UON_PROXY=$PROXY
UON_DOMAIN=$DOMAIN
UON_TLS=$TLS_MODE
UON_ALLOWED_IPS=${ALLOWED_IPS:-0.0.0.0/0 ::/0}
EOF
chmod 600 "$ENV_FILE"
umask 022

if [[ $BUILD -eq 1 ]]; then
  say "Construindo a imagem (alguns minutos na primeira vez)…"
  "${COMPOSE[@]}" build app migrate
fi

say "Iniciando o banco de dados…"
"${COMPOSE[@]}" up -d --wait postgres

say "Criando as tabelas…"
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" run --rm migrate node apps/api/dist/seed-base.js

say "Criando o usuário de banco da aplicação (sem permissão de alterar estrutura nem auditoria)…"
APP_PW=$(grep '^POSTGRES_APP_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
"${COMPOSE[@]}" exec -T postgres psql -U uon_owner -d uon_connect -v ON_ERROR_STOP=1 -v app_password="$APP_PW" -f - < docker/postgres/app-role.sql >/dev/null

say "Iniciando o aplicativo…"
# shellcheck disable=SC2046
"${COMPOSE[@]}" $(profiles) up -d
wait_ready

say "Criando a conta fundadora…"
"${COMPOSE[@]}" run --rm -e APP_BASE_URL="https://$DOMAIN" migrate \
  node apps/api/dist/bootstrap-founder.js --local --email "$FOUNDER_EMAIL" --name "$FOUNDER_NAME"

cat <<EOF

Instalação concluída.
  Endereço:   https://$DOMAIN
  Segredos:   $(pwd)/$ENV_FILE (permissão 600; faça uma cópia segura dele e do backup do banco)

Próximos passos:
  1. Abra o link acima (o da conta fundadora), defina a senha e ative a verificação em duas etapas.
  2. Em Administração › Usuários, cadastre as pessoas e gere o convite de cada uma.
  3. Agende o backup diário: scripts/backup-docker.sh (veja docs/INSTALAR.md).
EOF
