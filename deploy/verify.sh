#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — verificação PÓS-deploy (VPS).
# Confere containers, secrets, edge functions e as fontes de dados.
# Não altera nada.
#   bash deploy/verify.sh
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OK=0; FAIL=0; WARN=0
ok()   { echo -e "  \033[1;32m✔\033[0m $*"; OK=$((OK+1)); }
bad()  { echo -e "  \033[1;31m✘\033[0m $*"; FAIL=$((FAIL+1)); }
warn() { echo -e "  \033[1;33m!\033[0m $*"; WARN=$((WARN+1)); }
sec()  { echo -e "\n\033[1;36m$*\033[0m"; }

[ -f deploy/.env ] || { echo "deploy/.env ausente"; exit 1; }
set -a; . deploy/.env; set +a

API="${VITE_SUPABASE_URL:-}"
KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-}"
[ -n "$API" ] && [ -n "$KEY" ] || { echo "VITE_SUPABASE_URL / _PUBLISHABLE_KEY vazios em deploy/.env"; exit 1; }
FN="$API/functions/v1"

sec "1. Containers"
for c in supabase-db supabase-kong supabase-auth supabase-rest supabase-edge-functions; do
  st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo ausente)"
  [ "$st" = "running" ] && ok "$c: running" || bad "$c: $st"
done
st="$(docker inspect -f '{{.State.Status}}' nexus33-app-1 2>/dev/null \
      || docker inspect -f '{{.State.Status}}' "$(docker ps --filter ancestor=nexus33-app:latest -q | head -1)" 2>/dev/null \
      || echo ausente)"
[ "$st" = "running" ] && ok "frontend: running" || warn "frontend: $st"

sec "2. Secrets dentro do edge-runtime"
ENVDUMP="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' supabase-edge-functions 2>/dev/null || true)"
for k in SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID \
         SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if echo "$ENVDUMP" | grep -q "^${k}=."; then ok "$k presente"; else bad "$k AUSENTE (rode: bash deploy/fix-secrets.sh)"; fi
done
for k in GEMINI_API_KEY GROQ_API_KEY LOVABLE_API_KEY; do
  echo "$ENVDUMP" | grep -q "^${k}=." && ok "$k presente" || warn "$k ausente (IA cai no fallback local)"
done

sec "3. Edge functions"
code=$(curl -s -o /tmp/nx_health.json -w '%{http_code}' -H "Authorization: Bearer $KEY" "$FN/healthcheck")
[ "$code" = "200" ] && ok "healthcheck HTTP 200" || bad "healthcheck HTTP $code"
grep -q '"db":{"ok":true' /tmp/nx_health.json 2>/dev/null && ok "banco acessível" || bad "banco inacessível"
grep -q '"telegram":{"ok":true' /tmp/nx_health.json 2>/dev/null && ok "bot do Telegram válido" || warn "Telegram indisponível"

sec "4. Fontes de dados (football-api)"
curl -s -X POST "$FN/football-api" -H "Authorization: Bearer $KEY" \
     -H 'Content-Type: application/json' -d '{"diag":true}' -o /tmp/nx_diag.json
python3 - <<'PY' || warn "não foi possível interpretar o diagnóstico"
import json
d = json.load(open('/tmp/nx_diag.json'))
env = d.get('env', {})
for k, v in env.items():
    print(("  \033[1;32m✔\033[0m " if v == 'present' else "  \033[1;31m✘\033[0m ") + f"env {k}: {v}")
for s in d.get('sources', []):
    good = s.get('status') == 200 and (s.get('matches') or 0) >= 0 and not s.get('error')
    mark = "\033[1;32m✔\033[0m" if good else "\033[1;33m!\033[0m"
    print(f"  {mark} {s['source']}: status={s.get('status')} matches={s.get('matches')} {s.get('error','')}")
PY

sec "5. Jogos do dia (fluxo real do app)"
TODAY=$(date -u +%F)
curl -s -X POST "$FN/football-api" -H "Authorization: Bearer $KEY" \
     -H 'Content-Type: application/json' -d "{\"date\":\"$TODAY\"}" -o /tmp/nx_day.json
N=$(python3 -c "import json;print(len(json.load(open('/tmp/nx_day.json')).get('matches',[])))" 2>/dev/null || echo 0)
[ "${N:-0}" -gt 0 ] && ok "$N jogos para $TODAY" || bad "0 jogos para $TODAY — verifique SPORTSRC_API_KEY e o limite diário"

sec "6. Cron"
docker exec supabase-db psql -U postgres -tAc \
  "select jobname||' :: '||schedule||' :: '||case when active then 'ativo' else 'INATIVO' end from cron.job order by jobname;" \
  2>/dev/null | while read -r l; do [ -n "$l" ] && case "$l" in *INATIVO*) warn "$l";; *) ok "$l";; esac; done

echo -e "\n\033[1mResultado: $OK ok, $WARN avisos, $FAIL falhas\033[0m"
[ "$FAIL" -eq 0 ] || exit 1
