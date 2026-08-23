#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — agenda o envio diário do PLACAR EXATO (imagem) no Telegram
#
#   bash deploy/enable-correct-score-cron.sh            # 09:00 BRT
#   HORA_BRT=07 bash deploy/enable-correct-score-cron.sh # outro horário
#
# Cria/atualiza o job pg_cron "daily-correct-score-broadcast" na VPS.
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; . deploy/.env; set +a

API="${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
ANON="$(grep -E '^ANON_KEY=' supabase-docker/.env | cut -d= -f2-)"

HORA_BRT="${HORA_BRT:-09}"
# pg_cron roda em UTC; BRT = UTC-3
HORA_UTC=$(( (10#$HORA_BRT + 3) % 24 ))

echo "Agendando placar exato para ${HORA_BRT}:00 BRT (${HORA_UTC}:00 UTC)…"

docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid)
  FROM cron.job WHERE jobname = 'daily-correct-score-broadcast';

SELECT cron.schedule(
  'daily-correct-score-broadcast',
  '0 ${HORA_UTC} * * *',
  \$\$
  SELECT net.http_post(
    url := 'https://${API}/functions/v1/daily-correct-score-broadcast',
    headers := '{"Content-Type":"application/json","apikey":"${ANON}","Authorization":"Bearer ${ANON}"}'::jsonb,
    body := '{"source":"cron"}'::jsonb
  );
  \$\$
);

SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'daily-correct-score-broadcast';
SQL

echo
echo "✅ Job criado. Teste manual agora:"
echo "curl -s -X POST https://${API}/functions/v1/daily-correct-score-broadcast \\"
echo "  -H 'Content-Type: application/json' -H \"apikey: \$ANON_KEY\" -d '{\"force\":true}'"
