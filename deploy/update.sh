#!/usr/bin/env bash
# Atualiza o NEXUS 33 na VPS.
# O CI já sincroniza main antes de chamar este script.
#   bash deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VAULT="${NEXUS33_VAULT:-/etc/nexus33/secrets.env}"
if [ ! -f "$VAULT" ]; then
  echo "⚠ Cofre de chaves ausente ($VAULT)."
  echo "  Rode uma única vez: bash deploy/set-secrets.sh"
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
  bash deploy/sync-functions.sh
  bash deploy/fix-secrets.sh
  bash deploy/apply-migrations.sh
  # Cron estrutural já é validado por verify.sh. O script fix-cron.sh fica
  # disponível para correções manuais sem bloquear o deploy automático.
  bash deploy/enable-daily-broadcasts.sh
fi

# Frontend — mantém a mesma interface e infraestrutura, recriando somente
# o container da aplicação a partir do commit já validado pelo CI.
docker compose --env-file deploy/.env -f deploy/docker-compose.yml build --pull app
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --force-recreate app
docker image prune -f

# Verificação pós-deploy é parte obrigatória do deploy: qualquer falha real
# retorna código diferente de zero e faz o GitHub Actions marcar o deploy como falho.
bash deploy/verify.sh
echo "Atualização concluída com verificação pós-deploy aprovada."
