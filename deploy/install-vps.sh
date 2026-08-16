#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — instalação completa numa VPS Ubuntu (Docker)
# Sobe: Supabase self-hosted (Postgres, Auth, PostgREST, Realtime,
# Storage, Kong, Edge Runtime) + frontend + Caddy com HTTPS.
#
#   sudo bash deploy/install-vps.sh
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { echo -e "\n\033[1;33m▶ $*\033[0m"; }

# --- 1. Docker -------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 ausente"; exit 1; }

# --- 2. .env ---------------------------------------------------------
if [ ! -f deploy/.env ]; then
  cp deploy/.env.example deploy/.env
  echo "Criei deploy/.env — preencha os domínios e as chaves e rode de novo."
  exit 1
fi
set -a; . deploy/.env; set +a

# --- 3. Supabase self-hosted ----------------------------------------
if [ ! -d supabase-docker ]; then
  say "Baixando Supabase self-hosted (compose oficial)..."
  git clone --depth 1 https://github.com/supabase/supabase.git /tmp/supabase-src
  cp -r /tmp/supabase-src/docker supabase-docker
  rm -rf /tmp/supabase-src
  cp supabase-docker/.env.example supabase-docker/.env
fi

if ! grep -q "NEXUS33_CONFIGURED" supabase-docker/.env; then
  say "Gerando segredos do Supabase (JWT, senhas, chaves anon/service)..."
  JWT_SECRET="$(openssl rand -hex 32)"
  PG_PASS="$(openssl rand -hex 24)"
  DASH_PASS="$(openssl rand -hex 12)"

  # anon + service_role assinados com o JWT_SECRET (HS256, 10 anos)
  # Feito em python3 puro (hmac + base64url) — sem npm, sem dependências externas.
  gen_key() {
    JWT_SECRET="$JWT_SECRET" ROLE="$1" python3 - <<'PY'
import base64, hashlib, hmac, json, os, time

def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

secret = os.environ["JWT_SECRET"].encode()
iat = int(time.time())
header = {"alg": "HS256", "typ": "JWT"}
payload = {"role": os.environ["ROLE"], "iss": "supabase",
           "iat": iat, "exp": iat + 60 * 60 * 24 * 3650}
enc = lambda o: b64(json.dumps(o, separators=(",", ":")).encode())
signing_input = f"{enc(header)}.{enc(payload)}".encode()
sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
print(f"{signing_input.decode()}.{b64(sig)}")
PY
  }
  command -v python3 >/dev/null 2>&1 || { apt-get update -y && apt-get install -y python3; }
  ANON_KEY="$(gen_key anon)"
  SERVICE_KEY="$(gen_key service_role)"


  python3 - "$JWT_SECRET" "$PG_PASS" "$ANON_KEY" "$SERVICE_KEY" "$DASH_PASS" <<'PY'
import re, sys
jwt, pg, anon, svc, dash = sys.argv[1:6]
p = "supabase-docker/.env"
s = open(p).read()
def setv(s, k, v):
    if re.search(rf"(?m)^{k}=.*$", s):
        return re.sub(rf"(?m)^{k}=.*$", f"{k}={v}", s)
    return s + f"\n{k}={v}"
for k, v in [("JWT_SECRET", jwt), ("POSTGRES_PASSWORD", pg), ("ANON_KEY", anon),
             ("SERVICE_ROLE_KEY", svc), ("DASHBOARD_PASSWORD", dash)]:
    s = setv(s, k, v)
s += "\n# NEXUS33_CONFIGURED\n"
open(p, "w").write(s)
PY

  # URLs públicas
  sed -i "s|^SITE_URL=.*|SITE_URL=https://${APP_DOMAIN}|"        supabase-docker/.env
  sed -i "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://${API_DOMAIN}|" supabase-docker/.env
  sed -i "s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=https://${API_DOMAIN}|" supabase-docker/.env

  echo -e "\n\033[1;32mANON_KEY gerada:\033[0m\n$ANON_KEY\n"
  echo "→ Senha do Studio (user: supabase): $DASH_PASS"
fi

# --- 3b. Sincroniza as variáveis públicas do frontend ----------------
# Sem isso o bundle é compilado com o placeholder do .env.example e o app
# sobe totalmente quebrado (client Supabase com URL/chave inválidas).
say "Sincronizando VITE_* do frontend com o Supabase local..."
ANON_KEY="$(grep -E '^ANON_KEY=' supabase-docker/.env | cut -d= -f2- | tr -d '"')"
[ -n "$ANON_KEY" ] || { echo "ANON_KEY não encontrada em supabase-docker/.env"; exit 1; }

set_env() { # arquivo chave valor
  if grep -q "^${2}=" "$1"; then
    python3 - "$1" "$2" "$3" <<'PY'
import sys
path, key, val = sys.argv[1:4]
lines = open(path).read().splitlines()
out = [f"{key}={val}" if l.startswith(f"{key}=") else l for l in lines]
open(path, "w").write("\n".join(out) + "\n")
PY
  else
    echo "${2}=${3}" >> "$1"
  fi
}
set_env deploy/.env VITE_SUPABASE_URL "https://${API_DOMAIN}"
set_env deploy/.env VITE_SUPABASE_PUBLISHABLE_KEY "$ANON_KEY"
set_env deploy/.env VITE_SUPABASE_PROJECT_ID "${VITE_SUPABASE_PROJECT_ID:-selfhosted}"
set_env deploy/.env APP_PUBLIC_URL "${APP_PUBLIC_URL:-https://${APP_DOMAIN}}"
# Cadastro de novos usuários: sem SMTP configurado o GoTrue falha ao enviar o
# e-mail de confirmação e o signup quebra. Auto-confirma por padrão.
set_env supabase-docker/.env ENABLE_EMAIL_SIGNUP true
set_env supabase-docker/.env ENABLE_EMAIL_AUTOCONFIRM "${ENABLE_EMAIL_AUTOCONFIRM:-true}"
set_env supabase-docker/.env DISABLE_SIGNUP false
# o código aceita TELEGRAM_BOT_TOKEN ou TELEGRAM_API_KEY — espelha os dois
if [ -n "${TELEGRAM_BOT_TOKEN:-}${TELEGRAM_API_KEY:-}" ]; then
  set_env deploy/.env TELEGRAM_BOT_TOKEN "${TELEGRAM_BOT_TOKEN:-${TELEGRAM_API_KEY:-}}"
  set_env deploy/.env TELEGRAM_API_KEY   "${TELEGRAM_API_KEY:-${TELEGRAM_BOT_TOKEN:-}}"
fi
if [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  set_env deploy/.env TELEGRAM_ADMIN_CHAT_ID "${TELEGRAM_ADMIN_CHAT_ID:-$TELEGRAM_CHAT_ID}"
fi
set -a; . deploy/.env; set +a

# Edge functions do projeto
say "Copiando edge functions..."
bash deploy/sync-functions.sh

say "Subindo Supabase..."
(cd supabase-docker && docker compose up -d)

# Declara TODOS os secrets no serviço "functions" (o .env sozinho não chega
# ao container) e reinicia o edge-runtime.
say "Injetando secrets no edge-runtime..."
bash deploy/fix-secrets.sh || true

# --- 4. Migrations ---------------------------------------------------
say "Aguardando Postgres..."
for i in $(seq 1 60); do
  docker exec supabase-db pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
bash deploy/apply-migrations.sh

# --- 4b. Cron jobs apontando para a API local ------------------------
say "Ajustando cron jobs (pg_cron/pg_net) para o domínio local..."
bash deploy/fix-cron.sh || echo "⚠ revise os cron jobs com: bash deploy/fix-cron.sh"


# --- 5. Frontend + Caddy --------------------------------------------
say "Build do frontend e proxy HTTPS..."
case "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" in
  ""|*"<"*) echo "VITE_SUPABASE_PUBLISHABLE_KEY inválida em deploy/.env"; exit 1 ;;
esac
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build


say "Pronto!"
echo "App:    https://${APP_DOMAIN}"
echo "API:    https://${API_DOMAIN}"
echo "Studio: http://$(hostname -I | awk '{print $1}'):8000 (user supabase)"
