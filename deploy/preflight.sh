#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — verificação pré-migração.
# Roda ANTES do install-vps.sh e confirma que a VPS e os arquivos estão
# prontos. Não altera nada.
#   bash deploy/preflight.sh
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OK=0; FAIL=0; WARN=0
ok()   { echo -e "  \033[1;32m✔\033[0m $*"; OK=$((OK+1)); }
bad()  { echo -e "  \033[1;31m✘\033[0m $*"; FAIL=$((FAIL+1)); }
warn() { echo -e "  \033[1;33m!\033[0m $*"; WARN=$((WARN+1)); }
sec()  { echo -e "\n\033[1;36m$*\033[0m"; }

sec "1. Arquivos do kit"
for f in Dockerfile deploy/nginx.conf deploy/Caddyfile deploy/docker-compose.yml \
         deploy/install-vps.sh deploy/apply-migrations.sh deploy/sync-functions.sh \
         deploy/fix-secrets.sh deploy/fix-cron.sh deploy/import-users.sh \
         deploy/set-secrets.sh \
         deploy/update.sh deploy/backup.sh deploy/verify.sh deploy/.env.example \
         SELF-HOST.md TROUBLESHOOTING.md; do
  [ -f "$f" ] && ok "$f" || bad "faltando: $f"
done

sec "2. Conteúdo do projeto"
NF=$(ls -d supabase/functions/*/ 2>/dev/null | wc -l)
NM=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l)
[ "$NF" -gt 0 ] && ok "$NF edge functions" || bad "nenhuma edge function encontrada"
[ "$NM" -gt 0 ] && ok "$NM migrations" || bad "nenhuma migration encontrada"
grep -rl "yeyctdphzrmyxgskehru" supabase/migrations >/dev/null 2>&1 \
  && warn "$(grep -rl 'yeyctdphzrmyxgskehru' supabase/migrations | wc -l) migration(s) com o project-ref antigo — apply-migrations.sh substitui automaticamente" \
  || ok "nenhum project-ref hardcoded nas migrations"

sec "3. deploy/.env — domínios e URLs"
if [ ! -f deploy/.env ]; then
  bad "deploy/.env ainda não existe — copie de deploy/.env.example e preencha"
else
  set -a; . deploy/.env; set +a
  for K in APP_DOMAIN API_DOMAIN; do
    [ -n "${!K:-}" ] && ok "$K=${!K}" || bad "$K vazio (obrigatório)"
  done
  [ -n "${APP_PUBLIC_URL:-}" ] && ok "APP_PUBLIC_URL=$APP_PUBLIC_URL" \
    || warn "APP_PUBLIC_URL vazio — será derivado de https://${APP_DOMAIN:-?}"
  [ -n "${VITE_SUPABASE_URL:-}" ] && ok "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" \
    || warn "VITE_SUPABASE_URL vazio — install-vps.sh grava https://${API_DOMAIN:-?}"
  [ -n "${VITE_SUPABASE_PROJECT_ID:-}" ] && ok "VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID" \
    || warn "VITE_SUPABASE_PROJECT_ID vazio — usará 'selfhosted'"
  case "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" in
    ""|*"<"*) warn "VITE_SUPABASE_PUBLISHABLE_KEY será preenchida com a ANON_KEY gerada no 1º install" ;;
    *) ok "VITE_SUPABASE_PUBLISHABLE_KEY definida" ;;
  esac
fi

sec "4. Secrets das Edge Functions"
VAULT="${NEXUS33_VAULT:-/etc/nexus33/secrets.env}"
if [ -f "$VAULT" ]; then
  ok "cofre $VAULT presente (fora do git)"
  set -a; . "$VAULT"; set +a
else
  warn "cofre $VAULT ausente — rode: bash deploy/set-secrets.sh"
fi
if [ -f deploy/.env ] || [ -f "$VAULT" ]; then
  # obrigatórias: sem elas o app não funciona como no Lovable
  declare -A WHY=(
    [SPORTSRC_API_KEY]="jogos ao vivo e pré-jogo"
    [FOOTBALL_DATA_ORG_KEY]="fallback de partidas/ligas"
    [GEMINI_API_KEY]="leitura de jogo com pesquisa web"
    [GROQ_API_KEY]="análise IA dos sinais (primária)"
    [TELEGRAM_BOT_TOKEN]="envio dos sinais no Telegram"
    [TELEGRAM_CHAT_ID]="canal de destino dos sinais"
  )
  for K in SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY \
           TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
    if [ -n "${!K:-}" ]; then ok "$K (${WHY[$K]})"
    else bad "$K vazio — ${WHY[$K]} não vai funcionar (bash deploy/set-secrets.sh)"; fi
  done
  for K in TELEGRAM_ADMIN_CHAT_ID TELEGRAM_API_KEY LOVABLE_API_KEY; do
    [ -n "${!K:-}" ] && ok "$K (opcional)" || warn "$K vazio (opcional)"
  done
fi


sec "5. Ambiente da VPS"
command -v docker >/dev/null 2>&1 && ok "docker $(docker --version | awk '{print $3}' | tr -d ,)" \
  || warn "docker ausente — install-vps.sh instala"
docker compose version >/dev/null 2>&1 && ok "docker compose v2" || warn "docker compose v2 ausente"
command -v git >/dev/null 2>&1 && ok "git" || bad "git ausente (apt install git)"
command -v openssl >/dev/null 2>&1 && ok "openssl" || bad "openssl ausente"
command -v python3 >/dev/null 2>&1 && ok "python3" || bad "python3 ausente"
MEM=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
[ "$MEM" -ge 4 ] && ok "RAM ${MEM}GB" || warn "RAM ${MEM}GB (mínimo recomendado: 4GB)"
DISK=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
[ "${DISK:-0}" -ge 30 ] && ok "disco livre ${DISK}GB" || warn "disco livre ${DISK:-?}GB (recomendado 40GB+)"

sec "6. DNS"
if [ -n "${APP_DOMAIN:-}" ] && command -v getent >/dev/null 2>&1; then
  IP=$(curl -s --max-time 5 https://api.ipify.org || echo "")
  for D in "$APP_DOMAIN" "${API_DOMAIN:-}"; do
    [ -z "$D" ] && continue
    R=$(getent ahostsv4 "$D" 2>/dev/null | awk 'NR==1{print $1}')
    if [ -z "$R" ]; then bad "$D não resolve"
    elif [ -n "$IP" ] && [ "$R" != "$IP" ]; then warn "$D → $R (IP desta máquina: $IP)"
    else ok "$D → $R"; fi
  done
else
  warn "pule esta checagem se ainda não estiver na VPS"
fi

sec "7. Stack já instalada (se for atualização)"
if [ -d supabase-docker ]; then
  ok "supabase-docker presente"
  grep -q "NEXUS33_CONFIGURED" supabase-docker/.env 2>/dev/null \
    && ok "chaves do Supabase já geradas" || warn "chaves do Supabase ainda não geradas"
  [ -f supabase-docker/docker-compose.override.yml ] \
    && ok "override de secrets presente" \
    || warn "override ausente — rode: bash deploy/fix-secrets.sh"
else
  warn "primeira instalação (supabase-docker será criado)"
fi

sec "Resumo"
echo "  OK: $OK   Avisos: $WARN   Erros: $FAIL"
[ "$FAIL" -eq 0 ] && echo -e "\n\033[1;32mPronto: sudo bash deploy/install-vps.sh\033[0m" \
  || echo -e "\n\033[1;31mCorrija os erros acima antes de instalar.\033[0m"
exit 0
