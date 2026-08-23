#!/usr/bin/env bash
# Atualiza o NEXUS 33 na VPS após um git pull.
#   bash deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git pull --ff-only

VAULT="${NEXUS33_VAULT:-/etc/nexus33/secrets.env}"
if [ ! -f "$VAULT" ]; then
  echo "⚠ Cofre de chaves ausente ($VAULT)."
  echo "  Rode uma única vez:  bash deploy/set-secrets.sh"
fi

if [ -d supabase-docker ]; then
  # Mantém o cadastro habilitado também em instalações já existentes.
  # Alterar somente o .env não basta: o container de Auth precisa ser recriado
  # para receber ENABLE_EMAIL_SIGNUP/AUTOCONFIRM atualizados.
  python3 - <<'PY'
import re

path = "supabase-docker/.env"
text = open(path).read()
values = {
    "ENABLE_EMAIL_SIGNUP": "true",
    "ENABLE_EMAIL_AUTOCONFIRM": "true",
    "DISABLE_SIGNUP": "false",
}
for key, value in values.items():
    pattern = rf"(?m)^{re.escape(key)}=.*$"
    if re.search(pattern, text):
        text = re.sub(pattern, f"{key}={value}", text)
    else:
        text += f"\n{key}={value}"
open(path, "w").write(text.rstrip() + "\n")
PY

  (cd supabase-docker && docker compose up -d --force-recreate auth)
  # Edge functions
  bash deploy/sync-functions.sh
  # re-declara TODOS os secrets (deploy/.env + cofre) e reinicia o edge-runtime
  bash deploy/fix-secrets.sh
  # migrations novas (ledger em public.selfhost_migrations, idempotente)
  bash deploy/apply-migrations.sh || echo "⚠ revise as migrations manualmente"
  # cron jobs apontando para o domínio local
  bash deploy/fix-cron.sh || echo "⚠ revise os cron jobs manualmente"
  # envios diários em foto (placar exato + bet analyzer)
  bash deploy/enable-daily-broadcasts.sh || echo "⚠ revise os crons dos envios diários"

fi


# Frontend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build app
docker image prune -f
echo "Atualização concluída."
