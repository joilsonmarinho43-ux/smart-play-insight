#!/usr/bin/env bash
# Atualiza o NEXUS 33 na VPS após um git pull.
#   bash deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git pull --ff-only

VAULT="${NEXUS33_VAULT:-/etc/nexus33/secrets.env}"
if [ ! -f "$VAULT" ]; then
  echo "⚠ Cofre de chaves ausente ($VAULT)."
  echo "  Rode uma única vez:  bash deploy/set-secrets.sh"
fi

if [ -d supabase-docker ]; then
  # Edge functions
  bash deploy/sync-functions.sh
  # re-declara TODOS os secrets (deploy/.env + cofre) e reinicia o edge-runtime
  bash deploy/fix-secrets.sh
  # migrations novas (ledger em public.selfhost_migrations, idempotente)
  bash deploy/apply-migrations.sh || echo "⚠ revise as migrations manualmente"
  # cron jobs apontando para o domínio local
  bash deploy/fix-cron.sh || echo "⚠ revise os cron jobs manualmente"
fi


# Frontend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build app
docker image prune -f
echo "Atualização concluída."
