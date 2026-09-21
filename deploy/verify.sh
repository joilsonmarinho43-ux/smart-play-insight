#!/usr/bin/env bash
# NEXUS 33 — verificação PÓS-deploy (VPS).
# Confere containers, secrets, edge functions e as fontes de dados.
# Não altera nada.
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

# Healthcheck é protegido: chamadas internas exigem a service-role key.
# O segredo fica no cofre da VPS e nunca é impresso.
VAULT="${NEXUS33_VAULT:-/etc/nexus33/secrets.env}"
if [ -f "$VAULT" ]; then
  set -a; . "$VAULT"; set +a
fi

API="${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}"
KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
[ -n "$API" ] || { echo "VITE_SUPABASE_URL / SUPABASE_URL vazio"; exit 1; }
FN="$API/functions/v1"

# NEXUS 33 usa este container explicitamente. Não procurar por "functions"
# genericamente: a mesma VPS hospeda o FuneCob e não podemos cruzar serviços.
EDGE_CT="supabase-edge-functions"
# The key actually consumed by Deno is authoritative. Prefer it over any
# stale copy in supabase-docker/.env; never print its value.
EDGE_SERVICE_KEY="$(docker exec "$EDGE_CT" printenv SUPABASE_SERVICE_ROLE_KEY 2>/dev/null || true)"
if [ -n "$EDGE_SERVICE_KEY" ]; then
  SERVICE_KEY="$EDGE_SERVICE_KEY"
fi

sec "1. Containers"
for c in supabase-db supabase-kong supabase-auth supabase-rest; do
  st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo ausente)"
  [ "$st" = "running" ] && ok "$c: running" || bad "$c: $st"
done
EDGE_ST="$(docker inspect -f '{{.State.Status}}' "$EDGE_CT" 2>/dev/null || echo ausente)"
[ "$EDGE_ST" = "running" ] && ok "edge-runtime: running" || bad "edge-runtime: $EDGE_ST"
APP_ST="$(docker inspect -f '{{.State.Status}}' nexus33-app-1 2>/dev/null || true)"
if [ -z "$APP_ST" ]; then
  APP_ST="$(docker inspect -f '{{.State.Status}}' deploy-app-1 2>/dev/null || true)"
fi
if [ -z "$APP_ST" ]; then
  APP_ST="$(docker ps --filter ancestor=nexus33-app:latest --format '{{.Status}}' | head -1 || true)"
fi
[ "$APP_ST" = "running" ] && ok "frontend: running" || bad "frontend: ${APP_ST:-ausente}"

sec "2. Integrações e secrets do edge-runtime"
ENVDUMP="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$EDGE_CT" 2>/dev/null || true)"
if [ -z "$SERVICE_KEY" ] && [ -f supabase-docker/.env ]; then
  SERVICE_KEY="$(grep '^SERVICE_ROLE_KEY=' supabase-docker/.env | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$SERVICE_KEY" ]; then
  SERVICE_KEY="$(docker exec "$EDGE_CT" printenv SUPABASE_SERVICE_ROLE_KEY 2>/dev/null || true)"
fi
# Essas integrações são opcionais para o fluxo principal de dados. Ausência
# não derruba o deploy; quando presentes, são verificadas explicitamente.
for k in SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID GEMINI_API_KEY GROQ_API_KEY; do
  if echo "$ENVDUMP" | grep -q "^$k=."; then
    ok "$k presente"
  else
    warn "$k ausente — fallback/integração correspondente permanece desativado"
  fi
done
if [ -n "$SERVICE_KEY" ]; then
  ok "SUPABASE_SERVICE_ROLE_KEY disponível para probes internos"
else
  warn "SUPABASE_SERVICE_ROLE_KEY não disponível — probes protegidos serão pulados"
fi

sec "3. Edge functions"
if [ -n "$SERVICE_KEY" ]; then
  code="$(curl -s -o /tmp/nx_health.json -w '%{http_code}' \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "apikey: $SERVICE_KEY" "$FN/healthcheck")"
  [ "$code" = "200" ] && ok "healthcheck HTTP 200" || bad "healthcheck HTTP $code"
  grep -q '"db":{"ok":true' /tmp/nx_health.json 2>/dev/null && ok "banco acessível" || bad "banco inacessível"
  grep -q '"telegram":{"ok":true' /tmp/nx_health.json 2>/dev/null && ok "bot do Telegram válido" || warn "Telegram indisponível"
else
  # Validação local do banco substitui o probe autenticado quando o segredo
  # não está configurado na instalação. Não enfraquece o endpoint.
  DB_OK="$(docker exec supabase-db psql -U postgres -d postgres -Atqc 'select 1' 2>/dev/null || true)"
  [ "$DB_OK" = "1" ] && ok "banco acessível (probe local)" || bad "banco inacessível"
  warn "healthcheck protegido não testado: service-role ausente"
fi

sec "4. Fontes de dados (football-api)"
if [ -n "$SERVICE_KEY" ]; then
  curl -s -X POST "$FN/football-api" -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" \
       -H 'Content-Type: application/json' -d '{"diag":true}' -o /tmp/nx_diag.json
elif [ -n "$KEY" ]; then
  curl -s -X POST "$FN/football-api" -H "Authorization: Bearer $KEY" \
       -H 'Content-Type: application/json' -d '{"diag":true}' -o /tmp/nx_diag.json
else
  printf '{"sources":[],"env":{}}' > /tmp/nx_diag.json
  warn "diagnóstico autenticado de football-api não executado: publishable key ausente"
fi
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
if [ -n "$SERVICE_KEY" ]; then
  curl -s -X POST "$FN/football-api" -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" \
       -H 'Content-Type: application/json' -d "{\"date\":\"$TODAY\"}" -o /tmp/nx_day.json
elif [ -n "$KEY" ]; then
  curl -s -X POST "$FN/football-api" -H "Authorization: Bearer $KEY" \
       -H 'Content-Type: application/json' -d "{\"date\":\"$TODAY\"}" -o /tmp/nx_day.json
else
  printf '{"matches":[]}' > /tmp/nx_day.json
  warn "fluxo externo não testado: publishable key ausente"
fi
N=$(python3 -c "import json;print(len(json.load(open('/tmp/nx_day.json')).get('matches',[])))" 2>/dev/null || echo 0)
if [ "${N:-0}" -gt 0 ]; then
  ok "$N jogos para $TODAY"
else
  warn "0 jogos para $TODAY — calendário vazio ou fonte sem partidas no momento"
fi

sec "6. Cron"
mapfile -t CRON_ROWS < <(docker exec supabase-db psql -U postgres -At -F $'\t' -c \
  "select jobname, active::text, command from cron.job order by jobname;" 2>/dev/null || true)

if [ "${#CRON_ROWS[@]}" -eq 0 ]; then
  warn "não foi possível ler cron.job"
else
  for row in "${CRON_ROWS[@]}"; do
    IFS=$'\t' read -r jobname active command <<< "$row"
    [ -n "$jobname" ] || continue

    if printf '%s\n' "$jobname $command" | grep -Eiq \
      'daily-bet-analyzer-broadcast|daily-correct-score-broadcast|daily-ticket-settle|daily-bingo-broadcast|telegram-signal|scanner-pro-server|auto-mode-server'; then
      bad "cron PROIBIDO detectado: $jobname"
      continue
    fi

    if [ "$active" = "false" ]; then
      warn "$jobname :: INATIVO"
    else
      ok "$jobname :: ativo"
    fi
  done
fi
echo -e "\n\033[1mResultado: $OK ok, $WARN avisos, $FAIL falhas\033[0m"
[ "$FAIL" -eq 0 ] || exit 1
