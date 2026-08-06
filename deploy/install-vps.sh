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
  echo "→ Copie para VITE_SUPABASE_PUBLISHABLE_KEY em deploy/.env"
  echo "→ Senha do Studio (user: supabase): $DASH_PASS"
fi

# Secrets das edge functions
say "Aplicando secrets das edge functions..."
for K in SPORTSRC_API_KEY FOOTBALL_DATA_ORG_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID \
         TELEGRAM_API_KEY GEMINI_API_KEY GROQ_API_KEY LOVABLE_API_KEY APP_PUBLIC_URL; do
  V="${!K:-}"
  [ -z "$V" ] && continue
  grep -q "^${K}=" supabase-docker/.env \
    && sed -i "s|^${K}=.*|${K}=${V}|" supabase-docker/.env \
    || echo "${K}=${V}" >> supabase-docker/.env
done

# Edge functions do projeto
say "Copiando edge functions..."
bash deploy/sync-functions.sh

# Declara os secrets no serviço "functions" (senão o container não os enxerga)
say "Injetando secrets no edge-runtime..."
bash deploy/fix-secrets.sh || true

say "Subindo Supabase..."
(cd supabase-docker && docker compose up -d)

# --- 4. Migrations ---------------------------------------------------
say "Aguardando Postgres..."
for i in $(seq 1 60); do
  docker exec supabase-db pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
bash deploy/apply-migrations.sh

# --- 5. Frontend + Caddy --------------------------------------------
say "Build do frontend e proxy HTTPS..."
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

say "Pronto!"
echo "App:    https://${APP_DOMAIN}"
echo "API:    https://${API_DOMAIN}"
echo "Studio: http://$(hostname -I | awk '{print $1}'):8000 (user supabase)"
