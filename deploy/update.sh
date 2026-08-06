#!/usr/bin/env bash
# Atualiza o NEXUS 33 na VPS após um git pull.
#   bash deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git pull --ff-only

# Edge functions
if [ -d supabase-docker ]; then
  bash deploy/sync-functions.sh
  # re-declara os secrets no serviço functions e reinicia o edge-runtime
  bash deploy/fix-secrets.sh
fi

# Migrations novas (idempotentes: use IF NOT EXISTS nas suas migrations)
bash deploy/apply-migrations.sh || echo "⚠ revise as migrations manualmente"

# Frontend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build app
docker image prune -f
echo "Atualização concluída."
