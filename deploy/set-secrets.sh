#!/usr/bin/env bash
# NEXUS 33 — cadastro das chaves reais na VPS; nunca no repositório.
set -euo pipefail
VAULT_DIR="${NEXUS33_VAULT_DIR:-/etc/nexus33}";VAULT="${NEXUS33_VAULT:-$VAULT_DIR/secrets.env}"
REQUIRED=(SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID)
OPTIONAL=(TELEGRAM_ADMIN_CHAT_ID TELEGRAM_API_KEY SMTP_ADMIN_EMAIL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER_NAME)
declare -A WHY=([SPORTSRC_API_KEY]='jogos ao vivo e pré-jogo' [FOOTBALL_DATA_ORG_KEY]='fallback futebol' [GEMINI_API_KEY]='pesquisa e auditoria IA' [GROQ_API_KEY]='auditoria IA' [TELEGRAM_BOT_TOKEN]='envio Telegram' [TELEGRAM_CHAT_ID]='canal Telegram' [TELEGRAM_ADMIN_CHAT_ID]='alertas admin' [TELEGRAM_API_KEY]='espelho do BOT_TOKEN')
mkdir -p "$VAULT_DIR";touch "$VAULT";chmod 600 "$VAULT"
current(){ grep -E "^$1=" "$VAULT" 2>/dev/null|head -1|cut -d= -f2-; }
setv(){ local k="$1" v="$2" tmp;tmp="$(mktemp)";grep -vE "^${k}=" "$VAULT">"$tmp" 2>/dev/null||true;printf '%s=%s\n' "$k" "$v">>"$tmp";mv "$tmp" "$VAULT";chmod 600 "$VAULT"; }
FROM_ENV=0;[ "${1:-}" = '--from-env' ]&&FROM_ENV=1
for K in "${REQUIRED[@]}" "${OPTIONAL[@]}";do CUR="$(current "$K")";if [ "$FROM_ENV" -eq 1 ];then V="${!K:-}";[ -n "$V" ]&&setv "$K" "$V";continue;fi;[ -n "$CUR" ]&&echo "✓ $K já definido (${#CUR} chars) — Enter mantém"||echo "• $K — ${WHY[$K]}";read -r -s -p "  $K: " V||V='';echo;[ -n "$V" ]&&setv "$K" "$V";done
BOT="$(current TELEGRAM_BOT_TOKEN)";API="$(current TELEGRAM_API_KEY)";[ -z "$API" ]&&[ -n "$BOT" ]&&setv TELEGRAM_API_KEY "$BOT";[ -z "$BOT" ]&&[ -n "$API" ]&&setv TELEGRAM_BOT_TOKEN "$API";CHAT="$(current TELEGRAM_CHAT_ID)";ADM="$(current TELEGRAM_ADMIN_CHAT_ID)";[ -z "$ADM" ]&&[ -n "$CHAT" ]&&setv TELEGRAM_ADMIN_CHAT_ID "$CHAT"
echo "Chaves gravadas em $VAULT (chmod 600, fora do git).";MISSING=0;for K in "${REQUIRED[@]}";do [ -n "$(current "$K")" ]||{ echo "✗ $K vazia";MISSING=1;};done;[ "$MISSING" -eq 1 ]&&echo '⚠ Complete as chaves obrigatórias.'||echo '✅ Todas as obrigatórias definidas.';echo 'Aplique nas Edge Functions com: bash deploy/fix-secrets.sh'
