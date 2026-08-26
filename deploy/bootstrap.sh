#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — comando único de bootstrap na VPS
#
#   cd /opt/nexus33 && git pull && bash deploy/bootstrap.sh
#
# Faz tudo de uma vez:
#   1. pergunta (uma única vez, entrada oculta) as chaves reais
#   2. grava /etc/nexus33/secrets.env com chmod 600 (fora do git)
#   3. roda deploy/fix-secrets.sh  (injeta nas Edge Functions)
#   4. roda deploy/update.sh       (frontend + migrations + cron)
#   5. reinicia o edge-runtime
#   6. valida futebol / IAs / Telegram via healthcheck
#
# Se as chaves já existirem no cofre, basta dar Enter em cada pergunta
# (ou rodar com --no-prompt para pular direto para os passos 3-6).
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VAULT_DIR="${NEXUS33_VAULT_DIR:-/etc/nexus33}"
VAULT="${NEXUS33_VAULT:-$VAULT_DIR/secrets.env}"

KEYS=(SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY
      TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_ADMIN_CHAT_ID
      TELEGRAM_API_KEY LOVABLE_API_KEY)

declare -A WHY=(
  [SPORTSRC_API_KEY]="jogos ao vivo e pré-jogo"
  [FOOTBALL_DATA_ORG_KEY]="fallback de partidas/ligas"
  [GEMINI_API_KEY]="leitura de jogo com pesquisa web"
  [GROQ_API_KEY]="análise IA dos sinais (primária)"
  [TELEGRAM_BOT_TOKEN]="envio dos sinais no Telegram"
  [TELEGRAM_CHAT_ID]="canal de destino dos sinais"
  [TELEGRAM_ADMIN_CHAT_ID]="alertas admin (Enter = usa o CHAT_ID)"
  [TELEGRAM_API_KEY]="espelho do BOT_TOKEN (Enter = usa o BOT_TOKEN)"
  [LOVABLE_API_KEY]="gateway de IA Lovable (opcional)"
)

mkdir -p "$VAULT_DIR"
touch "$VAULT"; chmod 600 "$VAULT"

current() { grep -E "^$1=" "$VAULT" 2>/dev/null | head -1 | cut -d= -f2- ; }
setv() {
  local k="$1" v="$2" tmp; tmp="$(mktemp)"
  grep -vE "^${k}=" "$VAULT" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  mv "$tmp" "$VAULT"; chmod 600 "$VAULT"
}

if [ "${1:-}" != "--no-prompt" ]; then
  echo "── 1/6  Chaves (entrada oculta; Enter mantém o valor atual) ──"
  for K in "${KEYS[@]}"; do
    CUR="$(current "$K")"
    if [ -n "$CUR" ]; then echo "  ✓ $K já definido (${#CUR} chars) — ${WHY[$K]}"
    else echo "  • $K — ${WHY[$K]}"; fi
    read -r -s -p "    $K: " V </dev/tty || V=""
    echo
    [ -n "$V" ] && setv "$K" "$V"
  done
  # espelhos automáticos
  BOT="$(current TELEGRAM_BOT_TOKEN)"; [ -z "$(current TELEGRAM_API_KEY)" ] && [ -n "$BOT" ] && setv TELEGRAM_API_KEY "$BOT"
  CHAT="$(current TELEGRAM_CHAT_ID)"; [ -z "$(current TELEGRAM_ADMIN_CHAT_ID)" ] && [ -n "$CHAT" ] && setv TELEGRAM_ADMIN_CHAT_ID "$CHAT"
fi

echo "── 2/6  Cofre gravado em $VAULT (chmod 600, fora do git) ──"
MISSING=0
for K in SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  [ -n "$(current "$K")" ] || { echo "  ✗ $K vazia"; MISSING=1; }
done
[ "$MISSING" -eq 1 ] && { echo "⚠ Rode de novo e preencha as obrigatórias."; exit 1; }
echo "  ✅ todas as obrigatórias presentes"

echo "── 3/6  Injetando secrets nas Edge Functions ──"
bash deploy/fix-secrets.sh

echo "── 4/6  Atualizando app, migrations e cron ──"
bash deploy/update.sh

echo "── 5/6  Reiniciando o edge-runtime ──"
(cd supabase-docker && docker compose restart functions >/dev/null)
for i in $(seq 1 30); do sleep 2; docker ps --format '{{.Names}}' | grep -qE 'edge-functions|supabase-functions' && break; done
sleep 5

echo "── 6/6  Validando futebol / IAs / Telegram ──"
set -a; . deploy/.env; set +a
ANON="$(grep -E '^ANON_KEY=' supabase-docker/.env | head -1 | cut -d= -f2- | tr -d '"')"
OUT="$(curl -s --max-time 25 -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
        "https://${API_DOMAIN}/functions/v1/healthcheck" || true)"
echo "$OUT" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print("  ✗ healthcheck não respondeu JSON"); sys.exit(1)
m=lambda b: "✓" if b else "✗"
p=d.get("providers",{})
print(f"  {m(d.get(\"db\",{}).get(\"ok\"))} banco de dados")
print(f"  {m(d.get(\"telegram\",{}).get(\"ok\"))} Telegram  ({d.get(\"telegram\",{}).get(\"username\") or d.get(\"telegram\",{}).get(\"error\")})")
print(f"  {m(p.get(\"sportsrc\",{}).get(\"ok\"))} SportsRC (futebol ao vivo)")
print(f"  {m(p.get(\"footballDataOrg\",{}).get(\"ok\"))} football-data.org")
print(f"  {m(p.get(\"theSportsDb\",{}).get(\"ok\"))} TheSportsDB")
print("\n  RESULTADO:", "✅ tudo operacional" if d.get("ok") else "⚠ revise os itens ✗ acima")
' || echo "$OUT" | head -c 400

CT="$(docker ps --format '{{.Names}}' | grep -E 'edge-functions|supabase-functions' | head -1)"
echo
echo "IAs dentro do edge-runtime:"
for K in GROQ_API_KEY GEMINI_API_KEY; do
  V="$(docker exec "$CT" printenv "$K" 2>/dev/null || true)"
  [ -n "$V" ] && echo "  ✓ $K (${#V} chars)" || echo "  ✗ $K ausente"
done
echo
echo "App: https://${APP_DOMAIN}   API: https://${API_DOMAIN}"
