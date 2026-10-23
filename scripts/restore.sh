#!/usr/bin/env bash
# UON CONNECT — restauração a partir de um diretório criado por backup.sh.
# Restaura em um banco VAZIO (recomendado: restaurar primeiro em homologação e validar).
# Uso: DATABASE_URL=... STORAGE_DIR=./storage/files scripts/restore.sh ./backups/20261023T120000Z
set -euo pipefail
SRC="${1:?informe o diretório do backup}"
: "${DATABASE_URL:?defina DATABASE_URL do banco de destino (vazio)}"
STORAGE_DIR="${STORAGE_DIR:-./storage/files}"

echo "[restore] verificando integridade dos arquivos do backup"
( cd "$SRC" && sha256sum --check --quiet SHA256SUMS )

TABLES=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [ "$TABLES" != "0" ] && [ "${FORCE_RESTORE:-}" != "yes" ]; then
  echo "[restore] o banco de destino não está vazio ($TABLES tabelas). Use um banco novo ou FORCE_RESTORE=yes." >&2
  exit 1
fi

echo "[restore] banco"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$SRC/database.dump"

if [ -f "$SRC/files.tar.gz" ]; then
  echo "[restore] arquivos → $STORAGE_DIR"
  mkdir -p "$STORAGE_DIR"
  tar -xzf "$SRC/files.tar.gz" -C "$STORAGE_DIR"
fi
echo "[restore] concluído. Verifique a cadeia de auditoria: npm run audit:verify"
