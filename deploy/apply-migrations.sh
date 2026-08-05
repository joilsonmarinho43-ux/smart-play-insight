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

echo "Preparando migrations (host/anon key do cron + unschedule tolerante)..."
for f in supabase/migrations/*.sql; do
  out="$TMP/$(basename "$f")"
  sed -E \
      -e "s|https://${OLD_REF}.supabase.co|https://${NEW_API}|g" \
      -e "s|${OLD_REF}|selfhosted|g" \
      -e "s|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]*|${ANON}|g" \
      -e "s|SELECT[[:space:]]+cron\.unschedule\(([0-9]+)\)[[:space:]]*;|SELECT cron.unschedule(jobid) FROM cron.job WHERE jobid = \1;|Ig" \
      -e "s|SELECT[[:space:]]+cron\.unschedule\(('[^']*')\)[[:space:]]*;|SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = \1;|Ig" \
      "$f" > "$out"
done

echo "Habilitando extensões e ledger de migrations..."
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE TABLE IF NOT EXISTS public.selfhost_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

psql_q() { docker exec -i supabase-db psql -U postgres -d postgres -tAq -c "$1"; }

applied=0; skipped=0; assumed=0
for f in $(ls "$TMP"/*.sql | sort); do
  name="$(basename "$f")"

  # 1) Já registrado no ledger → pula
  if [ "$(psql_q "SELECT 1 FROM public.selfhost_migrations WHERE filename = '${name}'")" = "1" ]; then
    echo "· $name (já aplicada)"
    skipped=$((skipped+1)); continue
  fi

  echo "→ $name"
  log="$TMP/${name}.log"
  if docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" > "$log" 2>&1; then
    applied=$((applied+1))
  elif grep -qiE 'already exists|duplicate key|já existe|duplicate object' "$log"; then
    # 2) Instalação parcial anterior: objeto já existe → considera aplicada
    echo "  ↳ objetos já existentes; marcando como aplicada"
    assumed=$((assumed+1))
  else
    echo "----- ERRO em $name -----"; cat "$log"; exit 1
  fi

  psql_q "INSERT INTO public.selfhost_migrations (filename) VALUES ('${name}')
          ON CONFLICT (filename) DO NOTHING" >/dev/null
done

echo "Migrations OK — novas: $applied | já aplicadas: $skipped | pré-existentes: $assumed"


echo "Migrations aplicadas com sucesso."
docker exec -i supabase-db psql -U postgres -d postgres \
  -c "select jobname, schedule from cron.job order by jobname;"
