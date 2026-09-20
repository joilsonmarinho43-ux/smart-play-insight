#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — diagnostica e corrige o pg_cron no Supabase self-hosted
#
#   bash deploy/fix-cron.sh
#
# - remove schedulers legados que não pertencem ao Nexus Core
# - reaponta jobs restantes que ainda usem o host antigo
# - normaliza tokens JWT de cron para o SERVICE_ROLE_KEY local
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; . deploy/.env; set +a

OLD_REF="yeyctdphzrmyxgskehru"
NEW_API="${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
SERVICE_ROLE_KEY="$(grep -E '^SERVICE_ROLE_KEY=' supabase-docker/.env | cut -d= -f2-)"
[ -n "$SERVICE_ROLE_KEY" ] || { echo "SERVICE_ROLE_KEY ausente em supabase-docker/.env"; exit 1; }

# No Supabase self-hosted, cron.job normalmente pertence ao administrador
# da extensão. O papel postgres pode consultar a tabela, mas não possuir ACL
# para alterar jobs criados por outro owner. Use supabase_admin quando existir.
if docker exec -i supabase-db psql -U postgres -d postgres -tAc   "SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin' LIMIT 1;" | grep -q '^1$'; then
  CRON_DB_USER="supabase_admin"
else
  CRON_DB_USER="postgres"
fi
echo "Usuário PostgreSQL para manutenção do pg_cron: $CRON_DB_USER"

docker exec -i supabase-db psql -U "$CRON_DB_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
-- Remove definitivamente schedulers legados que não pertencem ao fluxo atual.
-- A geração/registro de sinais permanece sob o Nexus Core.
DELETE FROM cron.job
WHERE jobname IN (
  'daily-bet-analyzer-broadcast',
  'daily-correct-score-broadcast',
  'daily-ticket-settle',
  'daily-bingo-broadcast',
  'telegram-signal',
  'scanner-pro-server',
  'auto-mode-server',
  'invoke-scanner-pro-server',
  'invoke-auto-mode-server'
);

-- Reaponta host antigo e chave antiga em jobs legítimos que permaneçam.
UPDATE cron.job
   SET command = replace(command, 'https://${OLD_REF}.supabase.co', 'https://${NEW_API}')
 WHERE command LIKE '%${OLD_REF}.supabase.co%';

UPDATE cron.job
   SET command = regexp_replace(
     command,
     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\\.[A-Za-z0-9_.-]*',
     '${SERVICE_ROLE_KEY}',
     'g'
   )
 WHERE command ~ 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\\.';

SELECT jobid, jobname, schedule, active, username
FROM cron.job
ORDER BY jobname;
SQL

echo
echo "Últimas execuções:"
docker exec -i supabase-db psql -U "$CRON_DB_USER" -d postgres -c   "SELECT jobid, status, return_message, start_time
     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 15;"
