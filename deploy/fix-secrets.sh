#!/usr/bin/env bash
# =====================================================================
# Injeta os secrets das edge functions no container "functions".
#
# No Supabase self-hosted o serviço `functions` só enxerga as variáveis
# que estão DECLARADAS no docker-compose. Colocar a chave no .env não
# basta — por isso as APIs de futebol (SportsRC / football-data.org) e
# as de IA voltam vazias.
#
# Este script gera supabase-docker/docker-compose.override.yml com todas
# as variáveis necessárias e reinicia o edge-runtime.
#
#   bash deploy/fix-secrets.sh
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SB="supabase-docker"
[ -d "$SB" ] || { echo "Pasta $SB não encontrada. Rode na raiz do projeto."; exit 1; }

# carrega deploy/.env (fonte das chaves) se existir
if [ -f deploy/.env ]; then
  set -a; . deploy/.env; set +a
fi

KEYS=(SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
      TELEGRAM_API_KEY GEMINI_API_KEY GROQ_API_KEY LOVABLE_API_KEY APP_PUBLIC_URL)

# 1. garante que as chaves estão no .env do supabase-docker
for K in "${KEYS[@]}"; do
  V="${!K:-}"
  [ -z "$V" ] && continue
  if grep -q "^${K}=" "$SB/.env"; then
    sed -i "s|^${K}=.*|${K}=${V}|" "$SB/.env"
  else
    echo "${K}=${V}" >> "$SB/.env"
  fi
done

# 2. gera o override declarando as variáveis no serviço functions
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

# 3. reinicia o edge-runtime
(cd "$SB" && docker compose up -d functions)

# 4. relatório do que efetivamente chegou no container
echo
echo "Variáveis dentro do container functions:"
for K in "${KEYS[@]}"; do
  V="$(docker exec supabase-edge-functions printenv "$K" 2>/dev/null || true)"
  if [ -z "$V" ]; then
    echo "  ✗ $K  (ausente — adicione em deploy/.env)"
  else
    echo "  ✓ $K  (${#V} chars)"
  fi
done

echo
echo "Teste rápido:"
echo "  curl -s -H \"Authorization: Bearer \$ANON_KEY\" https://SEU_DOMINIO_API/functions/v1/football-api?action=live | head -c 300"
