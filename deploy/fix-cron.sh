#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — diagnostica e corrige o pg_cron no Supabase self-hosted
#
#   bash deploy/fix-cron.sh
#
# - confirma que pg_cron/pg_net estão ativos
# - mostra os jobs e as últimas execuções
# - reaponta qualquer job que ainda chame a URL antiga para o seu
#   API_DOMAIN e normaliza tokens JWT de cron para o SERVICE_ROLE_KEY local
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; . deploy/.env; set +a

OLD_REF="yeyctdphzrmyxgskehru"
NEW_API="${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
SERVICE_ROLE_KEY="$(grep -E '^SERVICE_ROLE_KEY=' supabase-docker/.env | cut -d= -f2-)"
[ -n "$SERVICE_ROLE_KEY" ] || { echo "SERVICE_ROLE_KEY ausente em supabase-docker/.env"; exit 1; }

# Em algumas instalações Supabase self-hosted, cron.job pertence ao
# administrador da extensão (supabase_admin) e o papel postgres não tem
# ACL suficiente para remover jobs criados por outro owner. Use o owner
# administrativo quando existir; caso contrário, mantenha postgres.
if docker exec -i supabase-db psql -U postgres -d postgres -tAc   "SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin' LIMIT 1;" | grep -q '^1
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove definitivamente schedulers legados que não pertencem ao fluxo atual.
-- A geração de sinais não pode nascer de pg_cron fora do fluxo do Nexus Core.
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

-- reaponta host antigo e chave antiga
UPDATE cron.job
   SET command = replace(command, 'https://${OLD_REF}.supabase.co', 'https://${NEW_API}')
 WHERE command LIKE '%${OLD_REF}.supabase.co%';

UPDATE cron.job
   SET command = regexp_replace(command,
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]*',
        '${SERVICE_ROLE_KEY}', 'g')
 WHERE command ~ 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.';

SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
SQL

echo
echo "Últimas execuções:"
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "SELECT jobid, status, return_message, start_time
     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 15;"
; then
  CRON_DB_USER="supabase_admin"
else
  CRON_DB_USER="postgres"
fi
echo "Usuário PostgreSQL para manutenção do pg_cron: ${CRON_DB_USER}"

docker exec -i supabase-db psql -U "$CRON_DB_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Em instalações onde a tabela do pg_cron recebeu ACL restritiva,
-- o usuário operacional local (postgres) precisa conseguir higienizar
-- jobs legados antes da verificação do deploy.
GRANT SELECT, INSERT, UPDATE, DELETE ON cron.job TO postgres;

-- Remove definitivamente schedulers legados que não pertencem ao fluxo atual.
-- A geração de sinais não pode nascer de pg_cron fora do Nexus Core.
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

-- reaponta host antigo e chave antiga
UPDATE cron.job
   SET command = replace(command, 'https://${OLD_REF}.supabase.co', 'https://${NEW_API}')
 WHERE command LIKE '%${OLD_REF}.supabase.co%';

UPDATE cron.job
   SET command = regexp_replace(command,
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]*',
        '${SERVICE_ROLE_KEY}', 'g')
 WHERE command ~ 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.';

SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
SQL

echo
echo "Últimas execuções:"
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "SELECT jobid, status, return_message, start_time
     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 15;"
