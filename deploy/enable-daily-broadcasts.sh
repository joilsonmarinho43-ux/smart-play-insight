#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — agenda os envios diários em FOTO no Telegram:
#   • Placar Exato do dia
#   • Bet Analyzer do dia (5 cenários)
#
#   bash deploy/enable-daily-broadcasts.sh
#   HORA_PLACAR=10 HORA_ANALYZER=11 bash deploy/enable-daily-broadcasts.sh
#
# Horários em BRT (UTC-3). pg_cron roda em UTC — a conversão é automática.
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; . deploy/.env; set +a

API="${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
ANON="$(grep -E '^ANON_KEY=' supabase-docker/.env | cut -d= -f2-)"

HORA_PLACAR="${HORA_PLACAR:-08}"
HORA_ANALYZER="${HORA_ANALYZER:-09}"

utc() { echo $(( (10#$1 + 3) % 24 )); }

schedule() {
  local job="$1" fn="$2" hora_brt="$3"
  local hora_utc; hora_utc=$(utc "$hora_brt")
  echo "→ ${job}: ${hora_brt}:00 BRT (${hora_utc}:00 UTC)"
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = '${job}';

SELECT cron.schedule(
  '${job}',
  '0 ${hora_utc} * * *',
  \$\$
  SELECT net.http_post(
    url := 'https://${API}/functions/v1/${fn}',
    headers := '{"Content-Type":"application/json","apikey":"${ANON}","Authorization":"Bearer ${ANON}"}'::jsonb,
    body := '{"source":"cron"}'::jsonb
  );
  \$\$
);
SQL
}

schedule 'daily-correct-score-broadcast' 'daily-correct-score-broadcast' "$HORA_PLACAR"
schedule 'daily-bet-analyzer-broadcast'  'daily-bet-analyzer-broadcast'  "$HORA_ANALYZER"

docker exec -i supabase-db psql -U postgres -d postgres -c \
  "SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'daily-%broadcast';"

echo
echo "✅ Agendado. Teste manual:"
echo "curl -s -X POST https://${API}/functions/v1/daily-bet-analyzer-broadcast -H 'Content-Type: application/json' -H \"apikey: ${ANON:0:12}...\" -d '{\"force\":true}'"
