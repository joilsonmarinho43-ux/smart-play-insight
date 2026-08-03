#!/usr/bin/env bash
# Atualiza o NEXUS 33 na VPS após um git pull.
#   bash deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git pull --ff-only

# Edge functions
if [ -d supabase-docker ]; then
  rm -rf supabase-docker/volumes/functions/*
  cp -r supabase/functions/* supabase-docker/volumes/functions/
  (cd supabase-docker && docker compose restart functions)
fi

# Migrations novas (idempotentes: use IF NOT EXISTS nas suas migrations)
bash deploy/apply-migrations.sh || echo "⚠ revise as migrations manualmente"

# Frontend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build app
docker image prune -f
echo "Atualização concluída."
