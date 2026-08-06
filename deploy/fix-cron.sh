#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — diagnostica e corrige o pg_cron no Supabase self-hosted
#
#   bash deploy/fix-cron.sh
#
# - confirma que pg_cron/pg_net estão ativos
# - mostra os jobs e as últimas execuções
# - reaponta qualquer job que ainda chame a URL antiga para o seu
#   API_DOMAIN e a ANON_KEY locais
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; . deploy/.env; set +a

OLD_REF="yeyctdphzrmyxgskehru"
NEW_API="${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
ANON="$(grep -E '^ANON_KEY=' supabase-docker/.env | cut -d= -f2-)"

docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- reaponta host antigo e chave antiga
UPDATE cron.job
   SET command = replace(command, 'https://${OLD_REF}.supabase.co', 'https://${NEW_API}')
 WHERE command LIKE '%${OLD_REF}.supabase.co%';

UPDATE cron.job
   SET command = regexp_replace(command,
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]*',
        '${ANON}', 'g')
 WHERE command ~ 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.';

SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
SQL

echo
echo "Últimas execuções:"
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "SELECT jobid, status, return_message, start_time
     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 15;"
