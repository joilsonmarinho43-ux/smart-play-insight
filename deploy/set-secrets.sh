#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — cadastro das chaves reais NA VPS (nunca no repositório)
#
#   bash deploy/set-secrets.sh              # modo interativo
#   bash deploy/set-secrets.sh --from-env   # copia do ambiente atual
#
# As chaves são gravadas em /etc/nexus33/secrets.env (chmod 600), fora do
# git. deploy/fix-secrets.sh e deploy/update.sh leem esse arquivo e o
# aplicam nas Edge Functions automaticamente a cada deploy.
# =====================================================================
set -euo pipefail

VAULT_DIR="${NEXUS33_VAULT_DIR:-/etc/nexus33}"
VAULT="${NEXUS33_VAULT:-$VAULT_DIR/secrets.env}"

REQUIRED=(SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY
          TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID)
OPTIONAL=(TELEGRAM_ADMIN_CHAT_ID TELEGRAM_API_KEY LOVABLE_API_KEY)

declare -A WHY=(
  [SPORTSRC_API_KEY]="jogos ao vivo e pré-jogo"
  [FOOTBALL_DATA_ORG_KEY]="fallback de partidas/ligas"
  [GEMINI_API_KEY]="leitura de jogo com pesquisa web"
  [GROQ_API_KEY]="análise IA dos sinais (primária)"
  [TELEGRAM_BOT_TOKEN]="envio dos sinais no Telegram"
  [TELEGRAM_CHAT_ID]="canal de destino dos sinais"
  [TELEGRAM_ADMIN_CHAT_ID]="alertas administrativos (opcional)"
  [TELEGRAM_API_KEY]="espelho do BOT_TOKEN (opcional)"
  [LOVABLE_API_KEY]="gateway de IA Lovable (opcional)"
)

mkdir -p "$VAULT_DIR"
touch "$VAULT"; chmod 600 "$VAULT"

current() { grep -E "^$1=" "$VAULT" 2>/dev/null | head -1 | cut -d= -f2- ; }

setv() { # chave valor
  local k="$1" v="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^${k}=" "$VAULT" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  mv "$tmp" "$VAULT"; chmod 600 "$VAULT"
}

FROM_ENV=0
[ "${1:-}" = "--from-env" ] && FROM_ENV=1

for K in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do
  CUR="$(current "$K")"
  if [ "$FROM_ENV" -eq 1 ]; then
    V="${!K:-}"
    [ -n "$V" ] && setv "$K" "$V"
    continue
  fi
  if [ -n "$CUR" ]; then
    echo "  ✓ $K já definido (${#CUR} chars) — Enter mantém"
  else
    echo "  • $K — ${WHY[$K]}"
  fi
  read -r -p "    $K: " V || V=""
  [ -n "$V" ] && setv "$K" "$V"
done

# espelhos automáticos
BOT="$(current TELEGRAM_BOT_TOKEN)"; API="$(current TELEGRAM_API_KEY)"
[ -z "$API" ] && [ -n "$BOT" ] && setv TELEGRAM_API_KEY "$BOT"
[ -z "$BOT" ] && [ -n "$API" ] && setv TELEGRAM_BOT_TOKEN "$API"
CHAT="$(current TELEGRAM_CHAT_ID)"; ADM="$(current TELEGRAM_ADMIN_CHAT_ID)"
[ -z "$ADM" ] && [ -n "$CHAT" ] && setv TELEGRAM_ADMIN_CHAT_ID "$CHAT"

echo
echo "Chaves gravadas em $VAULT (chmod 600, fora do git)."
MISSING=0
for K in "${REQUIRED[@]}"; do
  [ -n "$(current "$K")" ] || { echo "  ✗ $K ainda vazia"; MISSING=1; }
done
[ "$MISSING" -eq 1 ] && echo "⚠ Rode de novo para completar." || echo "✅ Todas as obrigatórias definidas."
echo
echo "Agora aplique nas Edge Functions:  bash deploy/fix-secrets.sh"
