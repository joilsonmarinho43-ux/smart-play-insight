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
         deploy/update.sh deploy/backup.sh deploy/.env.example SELF-HOST.md; do
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

sec "3. deploy/.env"
if [ ! -f deploy/.env ]; then
  warn "deploy/.env ainda não existe — copie de deploy/.env.example e preencha"
else
  set -a; . deploy/.env; set +a
  for K in APP_DOMAIN API_DOMAIN VITE_SUPABASE_URL VITE_SUPABASE_PROJECT_ID; do
    [ -n "${!K:-}" ] && ok "$K=${!K}" || bad "$K vazio"
  done
  case "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" in
    ""|*"<"*) warn "VITE_SUPABASE_PUBLISHABLE_KEY será preenchida com a ANON_KEY gerada no 1º install" ;;
    *) ok "VITE_SUPABASE_PUBLISHABLE_KEY definida" ;;
  esac
  for K in SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID \
           GEMINI_API_KEY GROQ_API_KEY; do
    [ -n "${!K:-}" ] && ok "secret $K" || warn "secret $K vazio (a função que o usa ficará degradada)"
  done
fi

sec "4. Ambiente da VPS"
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

sec "5. DNS"
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

sec "Resumo"
echo "  OK: $OK   Avisos: $WARN   Erros: $FAIL"
[ "$FAIL" -eq 0 ] && echo -e "\n\033[1;32mPronto para rodar: sudo bash deploy/install-vps.sh\033[0m" \
  || echo -e "\n\033[1;31mCorrija os erros acima antes de instalar.\033[0m"
exit 0
