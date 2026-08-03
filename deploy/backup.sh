#!/usr/bin/env bash
# Backup diário do banco. Sugestão de cron:
#   0 4 * * * /opt/nexus33/deploy/backup.sh >> /var/log/nexus33-backup.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ROOT}/backups"
mkdir -p "$DEST"
FILE="$DEST/nexus33-$(date +%Y%m%d-%H%M).sql.gz"
docker exec supabase-db pg_dump -U postgres -d postgres | gzip > "$FILE"
# mantém 14 dias
find "$DEST" -name 'nexus33-*.sql.gz' -mtime +14 -delete
echo "Backup criado: $FILE"
