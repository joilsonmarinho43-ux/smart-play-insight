#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — injeta TODOS os secrets nas Edge Functions self-hosted
#
#   bash deploy/fix-secrets.sh
#
# Por que existe: no Supabase self-hosted o serviço `functions` só enxerga
# variáveis DECLARADAS no docker-compose. Colocar a chave no .env não basta
# — por isso as APIs de futebol (SportsRC / football-data.org), as IAs
# (Gemini / Groq) e o Telegram voltavam vazios.
#
# O script:
#   1. deriva valores faltantes (APP_PUBLIC_URL, SUPABASE_URL, chaves)
#   2. grava tudo em supabase-docker/.env
#   3. gera supabase-docker/docker-compose.override.yml declarando as vars
#   4. reinicia o edge-runtime e mostra ✓/✗ de cada variável
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SB="supabase-docker"
[ -d "$SB" ] || { echo "Pasta $SB não encontrada. Rode na raiz do projeto."; exit 1; }

# 1. carrega deploy/.env (fonte das chaves) + cofre fora do git
[ -f deploy/.env ] || { echo "deploy/.env não existe (copie de deploy/.env.example)."; exit 1; }
set -a; . deploy/.env; set +a

# /etc/nexus33/secrets.env tem prioridade: chaves reais da VPS, nunca versionadas.
VAULT="${NEXUS33_VAULT:-/etc/nexus33/secrets.env}"
if [ -f "$VAULT" ]; then
  set -a; . "$VAULT"; set +a
  echo "Cofre carregado: $VAULT"
else
  echo "ℹ Cofre $VAULT não existe — rode: bash deploy/set-secrets.sh"
fi

readenv() { grep -E "^$1=" "$SB/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }


# 2. derivações automáticas — nada de configuração manual
: "${APP_DOMAIN:?defina APP_DOMAIN em deploy/.env}"
: "${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
APP_PUBLIC_URL="${APP_PUBLIC_URL:-https://${APP_DOMAIN}}"
SUPABASE_URL="${SUPABASE_URL:-http://kong:8000}"
SUPABASE_ANON_KEY="$(readenv ANON_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(readenv SERVICE_ROLE_KEY)"
POSTGRES_PASSWORD="$(readenv POSTGRES_PASSWORD)"
SUPABASE_DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres}"
# o bot do Telegram aceita as duas variáveis (código usa BOT_TOKEN ou API_KEY)
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-${TELEGRAM_API_KEY:-}}"
TELEGRAM_API_KEY="${TELEGRAM_API_KEY:-${TELEGRAM_BOT_TOKEN:-}}"
TELEGRAM_ADMIN_CHAT_ID="${TELEGRAM_ADMIN_CHAT_ID:-${TELEGRAM_CHAT_ID:-}}"

# chaves obrigatórias para o app funcionar como no Lovable
REQUIRED=(SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY
          TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID)
# demais chaves suportadas
OPTIONAL=(TELEGRAM_ADMIN_CHAT_ID TELEGRAM_API_KEY LOVABLE_API_KEY)
# infra (derivadas)
INFRA=(APP_PUBLIC_URL SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL)

KEYS=("${REQUIRED[@]}" "${OPTIONAL[@]}" "${INFRA[@]}")

# 3. grava/atualiza no .env do supabase-docker
for K in "${KEYS[@]}"; do
  V="${!K:-}"
  [ -z "$V" ] && continue
  if grep -q "^${K}=" "$SB/.env"; then
    python3 - "$SB/.env" "$K" "$V" <<'PY'
import sys
path, key, val = sys.argv[1:4]
lines = open(path).read().splitlines()
out = [f"{key}={val}" if l.startswith(f"{key}=") else l for l in lines]
open(path, "w").write("\n".join(out) + "\n")
PY
  else
    printf '%s=%s\n' "$K" "$V" >> "$SB/.env"
  fi
done

# 4. override declarando as variáveis no serviço functions
OVR="$SB/docker-compose.override.yml"
{
  echo "# Gerado por deploy/fix-secrets.sh — não editar à mão"
  echo "services:"
  echo "  functions:"
  echo "    environment:"
  for K in "${KEYS[@]}"; do
    echo "      ${K}: \${${K}:-}"
  done
} > "$OVR"
echo "Override gravado em $OVR"

# 5. reinicia o edge-runtime
(cd "$SB" && docker compose up -d functions)
sleep 3

# 6. relatório
echo
echo "Variáveis dentro do container functions:"
MISSING=0
CT="$(docker ps --format '{{.Names}}' | grep -E 'edge-functions|supabase-functions' | head -1)"
CT="${CT:-supabase-edge-functions}"
for K in "${KEYS[@]}"; do
  V="$(docker exec "$CT" printenv "$K" 2>/dev/null || true)"
  if [ -z "$V" ]; then
    case " ${REQUIRED[*]} " in
      *" $K "*) echo "  ✗ $K  (OBRIGATÓRIA — preencha em deploy/.env)"; MISSING=1 ;;
      *)        echo "  – $K  (opcional, ausente)" ;;
    esac
  else
    echo "  ✓ $K  (${#V} chars)"
  fi
done

echo
if [ "$MISSING" -eq 1 ]; then
  echo "⚠ Preencha as chaves obrigatórias em deploy/.env e rode este script de novo."
else
  echo "✅ Todos os secrets obrigatórios estão no edge-runtime."
fi

echo
echo "Teste rápido:"
echo "  curl -s -H \"Authorization: Bearer \$(grep ^ANON_KEY= $SB/.env | cut -d= -f2-)\" \\"
echo "    https://${API_DOMAIN}/functions/v1/healthcheck | head -c 300"
