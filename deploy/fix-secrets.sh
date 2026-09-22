#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — injeta os secrets nas Edge Functions self-hosted
#
#   bash deploy/fix-secrets.sh
#
# No Supabase self-hosted o serviço `functions` só enxerga variáveis
# DECLARADAS no docker-compose. Colocar a chave no .env não basta — por
# isso as APIs de futebol (SportsRC / football-data.org), as IAs
# (Gemini / Groq) e o Telegram precisam ser injetados no edge-runtime.
#
# O script:
#   1. deriva valores faltantes (APP_PUBLIC_URL, SUPABASE_URL, chaves)
#   2. grava tudo em supabase-docker/.env
#   3. gera o env_file dedicado do edge-runtime
#   4. reinicia o edge-runtime e mostra ✓/✗ de cada variável
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SB="supabase-docker"
[ -d "$SB" ] || { echo "Pasta $SB não encontrada. Rode na raiz do projeto."; exit 1; }

[ -f deploy/.env ] || { echo "deploy/.env não existe (copie de deploy/.env.example)."; exit 1; }
set -a; . deploy/.env; set +a

VAULT="${NEXUS33_VAULT:-/etc/nexus33/secrets.env}"
if [ -f "$VAULT" ]; then
  set -a; . "$VAULT"; set +a
  echo "Cofre carregado: $VAULT"
else
  echo "ℹ Cofre $VAULT não existe — rode: bash deploy/set-secrets.sh"
fi

readenv() { grep -E "^$1=" "$SB/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

set_env() {
  local key="$1" val="$2"
  [ -z "$val" ] && return 0
  python3 - "$SB/.env" "$key" "$val" <<'PY'
import sys
path, key, val = sys.argv[1:4]
try:
    lines = open(path).read().splitlines()
except FileNotFoundError:
    lines = []
out = [line for line in lines if not line.startswith(f"{key}=")]
out.append(f"{key}={val}")
open(path, "w").write("\n".join(out) + "\n")
PY
}

: "${APP_DOMAIN:?defina APP_DOMAIN em deploy/.env}"
: "${API_DOMAIN:?defina API_DOMAIN em deploy/.env}"
APP_PUBLIC_URL="${APP_PUBLIC_URL:-https://${APP_DOMAIN}}"
SUPABASE_URL="${SUPABASE_URL:-http://kong:8000}"
SUPABASE_ANON_KEY="$(readenv ANON_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(readenv SERVICE_ROLE_KEY)"
POSTGRES_PASSWORD="$(readenv POSTGRES_PASSWORD)"
SUPABASE_DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-${TELEGRAM_API_KEY:-}}"
TELEGRAM_API_KEY="${TELEGRAM_API_KEY:-${TELEGRAM_BOT_TOKEN:-}}"
TELEGRAM_ADMIN_CHAT_ID="${TELEGRAM_ADMIN_CHAT_ID:-${TELEGRAM_CHAT_ID:-}}"

REQUIRED=(SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY GEMINI_API_KEY GROQ_API_KEY
          TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID)
OPTIONAL=(TELEGRAM_ADMIN_CHAT_ID TELEGRAM_API_KEY)
INFRA=(APP_PUBLIC_URL SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL)
SMTP=(SMTP_ADMIN_EMAIL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER_NAME)
KEYS=("${REQUIRED[@]}" "${OPTIONAL[@]}" "${INFRA[@]}" "${SMTP[@]}")
EDGE_KEYS=("${REQUIRED[@]}" "${OPTIONAL[@]}" "${INFRA[@]}")

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

FENV="$SB/functions.secrets.env"
: > "$FENV"; chmod 600 "$FENV"
for K in "${EDGE_KEYS[@]}"; do
  V="${!K:-}"
  [ -z "$V" ] && continue
  printf '%s=%s\n' "$K" "$V" >> "$FENV"
done
echo "Secrets literais gravados em $FENV ($(wc -l < "$FENV") vars)"

# SMTP de produção é aplicado ao .env do Auth. Nunca imprime valores secretos.
# URLs usadas pelo GoTrue para montar links de recuperação/confirmacao.
APP_PUBLIC_URL="${APP_PUBLIC_URL:-https://analista.funecob.com.br}"
set_env SITE_URL "$APP_PUBLIC_URL"
set_env GOTRUE_SITE_URL "$APP_PUBLIC_URL"
set_env ADDITIONAL_REDIRECT_URLS "$APP_PUBLIC_URL/reset-password"

SMTP_CONFIGURED=0
if [ -n "${SMTP_HOST:-}" ] && [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ] && [ -n "${SMTP_ADMIN_EMAIL:-}" ]; then SMTP_CONFIGURED=1; fi
echo "SMTP produção: $([ "$SMTP_CONFIGURED" -eq 1 ] && echo CONFIGURADO || echo NÃO CONFIGURADO)"


python3 - "$SB/docker-compose.yml" "functions.secrets.env" <<'PY'
import os, re, shutil, sys
path, envfile = sys.argv[1:3]
src = open(path).read()
if not path.endswith('.bak') and not os.path.exists(path + '.bak'):
    shutil.copy(path, path + '.bak')

lines = src.splitlines()
svc_starts = []
in_services = False
for i, l in enumerate(lines):
    if re.match(r'^services:\s*$', l):
        in_services = True; continue
    if in_services:
        if re.match(r'^\S', l):
            break
        m = re.match(r'^  ([A-Za-z0-9_.-]+):\s*$', l)
        if m:
            svc_starts.append((i, m.group(1)))

def block(idx):
    start = idx + 1
    end = len(lines)
    for j in range(start, len(lines)):
        if re.match(r'^  \S', lines[j]) or re.match(r'^\S', lines[j]):
            end = j; break
    return start, end

target = None
for idx, name in svc_starts:
    s, e = block(idx)
    body = "\n".join(lines[s:e])
    if 'edge-runtime' in body or 'supabase-edge-functions' in body or name in ('functions', 'edge-functions'):
        target = (idx, name, s, e); break

if not target:
    print("  ✗ serviço do edge-runtime não encontrado no docker-compose.yml"); sys.exit(1)

idx, name, s, e = target
body_lines = lines[s:e]
cleaned, skip = [], False
for l in body_lines:
    if re.match(r'^    env_file:\s*$', l):
        skip = True; continue
    if skip:
        if re.match(r'^      - ', l):
            if envfile in l:
                continue
            cleaned.append('    env_file:'); cleaned.append(l); skip = False; continue
        skip = False
    cleaned.append(l)
cleaned = [f'    env_file:', f'      - ./{envfile}'] + cleaned
lines[s:e] = cleaned
open(path, 'w').write("\n".join(lines) + "\n")
print(f"  ✓ env_file ./{envfile} injetado no serviço '{name}' (backup: {path}.bak)")
PY

rm -f "$SB/docker-compose.override.yml"
SVC="$(cd "$SB" && docker compose config --services 2>/dev/null | grep -E '^(functions|edge-functions)$' | head -1)"
SVC="${SVC:-functions}"
(cd "$SB" && docker compose up -d --force-recreate "$SVC")
sleep 5

echo
echo "Variáveis dentro do container do edge-runtime:"
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
  exit 1
else
  echo "✅ Todos os secrets obrigatórios estão no edge-runtime."
fi

echo
echo "Teste rápido:"
echo "  curl -s -H \"Authorization: Bearer \$(grep ^ANON_KEY= $SB/.env | cut -d= -f2-)\" \\"
echo "    https://${API_DOMAIN}/functions/v1/healthcheck | head -c 300"
