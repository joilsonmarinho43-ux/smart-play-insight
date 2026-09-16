#!/usr/bin/env bash
# NEXUS 33 — bootstrap operacional da VPS.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
VAULT_DIR="${NEXUS33_VAULT_DIR:-/etc/nexus33}"; VAULT="${NEXUS33_VAULT:-$VAULT_DIR/secrets.env}"
KEYS=(SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_ADMIN_CHAT_ID TELEGRAM_API_KEY)
declare -A WHY=([SPORTSRC_API_KEY]="jogos ao vivo e pré-jogo" [FOOTBALL_DATA_ORG_KEY]="fallback de partidas/ligas" [GEMINI_API_KEY]="leitura com pesquisa web" [GROQ_API_KEY]="auditoria e análise IA" [TELEGRAM_BOT_TOKEN]="envio dos sinais" [TELEGRAM_CHAT_ID]="canal dos sinais" [TELEGRAM_ADMIN_CHAT_ID]="alertas admin" [TELEGRAM_API_KEY]="espelho do BOT_TOKEN")
mkdir -p "$VAULT_DIR"; touch "$VAULT"; chmod 600 "$VAULT"
current(){ grep -E "^$1=" "$VAULT" 2>/dev/null|head -1|cut -d= -f2-; }
setv(){ local k="$1" v="$2" tmp; tmp="$(mktemp)"; grep -vE "^${k}=" "$VAULT">"$tmp" 2>/dev/null||true; printf '%s=%s\n' "$k" "$v">>"$tmp"; mv "$tmp" "$VAULT"; chmod 600 "$VAULT"; }
if [ "${1:-}" != "--no-prompt" ]; then
  echo "── Chaves (Enter mantém o valor atual) ──"
  for K in "${KEYS[@]}"; do CUR="$(current "$K")"; [ -n "$CUR" ]&&echo "  ✓ $K já definido (${#CUR} chars) — ${WHY[$K]}"||echo "  • $K — ${WHY[$K]}"; read -r -s -p "    $K: " V </dev/tty||V=""; echo; [ -n "$V" ]&&setv "$K" "$V"; done
  BOT="$(current TELEGRAM_BOT_TOKEN)"; [ -z "$(current TELEGRAM_API_KEY)" ]&&[ -n "$BOT" ]&&setv TELEGRAM_API_KEY "$BOT"
  CHAT="$(current TELEGRAM_CHAT_ID)"; [ -z "$(current TELEGRAM_ADMIN_CHAT_ID)" ]&&[ -n "$CHAT" ]&&setv TELEGRAM_ADMIN_CHAT_ID "$CHAT"
fi
echo "── Cofre: $VAULT (chmod 600, fora do git) ──"
MISSING=0; for K in SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do [ -n "$(current "$K")" ]||{ echo "  ✗ $K vazia"; MISSING=1; }; done
[ "$MISSING" -eq 1 ]&&{ echo "⚠ Preencha as chaves obrigatórias."; exit 1; }
bash deploy/fix-secrets.sh
bash deploy/update.sh
(cd supabase-docker&&docker compose restart functions >/dev/null)
for i in $(seq 1 30); do sleep 2; docker ps --format '{{.Names}}'|grep -qE 'edge-functions|supabase-functions'&&break; done
sleep 5
set -a; . deploy/.env; set +a
ANON="$(grep -E '^ANON_KEY=' supabase-docker/.env|head -1|cut -d= -f2-|tr -d '"')"
OUT="$(curl -s --max-time 25 -H "Authorization: Bearer $ANON" -H "apikey: $ANON" "https://${API_DOMAIN}/functions/v1/healthcheck"||true)"
echo "$OUT"|python3 -c 'import json,sys
try:d=json.load(sys.stdin)
except Exception:print("✗ healthcheck não respondeu JSON");sys.exit(1)
print("✓ banco de dados" if d.get("db",{}).get("ok") else "✗ banco de dados")
print("✓ Telegram" if d.get("telegram",{}).get("ok") else "✗ Telegram")
print("✓ SportsRC" if d.get("providers",{}).get("sportsrc",{}).get("ok") else "✗ SportsRC")
print("✓ healthcheck operacional" if d.get("ok") else "⚠ revise os itens acima")' || echo "$OUT"|head -c 400
CT="$(docker ps --format '{{.Names}}'|grep -E 'edge-functions|supabase-functions'|head -1)"; echo "IAs no edge-runtime:"; for K in GROQ_API_KEY GEMINI_API_KEY; do V="$(docker exec "$CT" printenv "$K" 2>/dev/null||true)"; [ -n "$V" ]&&echo "✓ $K (${#V} chars)"||echo "✗ $K ausente"; done
echo "App: https://${APP_DOMAIN}   API: https://${API_DOMAIN}"
