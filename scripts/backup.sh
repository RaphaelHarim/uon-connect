#!/usr/bin/env bash
# UON CONNECT — backup consistente do banco (pg_dump formato custom) e dos arquivos privados.
# Uso: DATABASE_URL=... STORAGE_DIR=./storage/files BACKUP_DIR=./backups scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL (usuário proprietário ou com leitura total)}"
STORAGE_DIR="${STORAGE_DIR:-./storage/files}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"
chmod 700 "$BACKUP_DIR" "$DEST"

echo "[backup] banco → $DEST/database.dump"
pg_dump --format=custom --no-owner --no-privileges --file="$DEST/database.dump" "$DATABASE_URL"

if [ -d "$STORAGE_DIR" ]; then
  echo "[backup] arquivos → $DEST/files.tar.gz"
  tar -czf "$DEST/files.tar.gz" -C "$STORAGE_DIR" .
else
  echo "[backup] aviso: diretório de arquivos $STORAGE_DIR não encontrado; somente o banco foi salvo"
fi

( cd "$DEST" && sha256sum ./* > SHA256SUMS )
echo "[backup] concluído: $DEST"
echo "[backup] lembre-se: copie para armazenamento externo e cifrado (política 3-2-1)."
