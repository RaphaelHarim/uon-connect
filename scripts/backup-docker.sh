#!/usr/bin/env bash
# UON CONNECT — backup de uma instalação feita com scripts/install.sh (Docker Compose).
# Mesmo formato de scripts/backup.sh (database.dump + files.tar.gz + SHA256SUMS), compatível com restore.sh.
# Uso: sudo ./scripts/backup-docker.sh [/caminho/dos/backups]     (padrão: ./backups)
# Cron diário às 2h:  0 2 * * * cd /opt/uon-connect && ./scripts/backup-docker.sh /var/backups/uon-connect
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env.production -f docker-compose.prod.yml)
BACKUP_DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$STAMP"
umask 077
mkdir -p "$DEST"

echo "[backup] banco → $DEST/database.dump"
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" uon_connect' > "$DEST/database.dump"

echo "[backup] arquivos → $DEST/files.tar.gz"
"${COMPOSE[@]}" exec -T app tar -czf - -C /data/files . > "$DEST/files.tar.gz"

( cd "$DEST" && sha256sum ./* > SHA256SUMS )
echo "[backup] concluído: $DEST"
echo "[backup] copie também para fora do servidor (armazenamento externo e cifrado) e guarde uma cópia de .env.production."
