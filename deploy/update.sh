#!/usr/bin/env bash
# Atualiza o NEXUS 33 na VPS após um git pull.
#   bash deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git pull --ff-only

# Edge functions
if [ -d supabase-docker ]; then
  # remove só as funções do projeto — o router "main" do edge-runtime fica
  for d in supabase-docker/volumes/functions/*/; do
    [ "$(basename "$d")" = "main" ] && continue
    rm -rf "$d"
  done
  cp -r supabase/functions/* supabase-docker/volumes/functions/
  bash deploy/sync-functions.sh
  (cd supabase-docker && docker compose restart functions)
fi

# Migrations novas (idempotentes: use IF NOT EXISTS nas suas migrations)
bash deploy/apply-migrations.sh || echo "⚠ revise as migrations manualmente"

# Frontend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build app
docker image prune -f
echo "Atualização concluída."
