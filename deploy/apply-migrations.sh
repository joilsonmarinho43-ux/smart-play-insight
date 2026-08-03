#!/usr/bin/env bash
# =====================================================================
# Aplica as 41 migrations do NEXUS 33 no Postgres self-hosted,
# em ordem cronológica, ajustando as URLs de pg_cron para o novo host.
#   bash deploy/apply-migrations.sh
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; . deploy/.env; set +a

OLD_REF="yeyctdphzrmyxgskehru"
NEW_API="${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
ANON="$(grep -E '^ANON_KEY=' supabase-docker/.env | cut -d= -f2-)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Preparando migrations (substituindo host e anon key do cron)..."
for f in supabase/migrations/*.sql; do
  out="$TMP/$(basename "$f")"
  sed -e "s|https://${OLD_REF}.supabase.co|https://${NEW_API}|g" \
      -e "s|${OLD_REF}|selfhosted|g" \
      -e "s|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]*|${ANON}|g" \
      "$f" > "$out"
done

echo "Habilitando extensões..."
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
SQL

for f in $(ls "$TMP"/*.sql | sort); do
  echo "→ $(basename "$f")"
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done

echo "Migrations aplicadas com sucesso."
docker exec -i supabase-db psql -U postgres -d postgres \
  -c "select jobname, schedule from cron.job order by jobname;"
