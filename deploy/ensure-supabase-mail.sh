#!/usr/bin/env bash
# NEXUS 33 — garante o serviço SMTP interno usado pelo GoTrue.
# A configuração atual do Auth espera supabase-mail:2500.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="supabase-docker/docker-compose.yml"

[ -f "$COMPOSE" ] || exit 0

if grep -qE '^  supabase-mail:' "$COMPOSE"; then
  echo "supabase-mail já configurado."
  exit 0
fi

python3 - <<'PY'
from pathlib import Path

p = Path("supabase-docker/docker-compose.yml")
s = p.read_text()

service = """  supabase-mail:
    container_name: supabase-mail
    image: inbucket/inbucket:stable
    restart: unless-stopped
    expose:
      - "2500"
      - "9000"
      - "1100"

"""

marker = "  meta:\n"
if marker not in s:
    raise SystemExit("Não encontrei o ponto seguro para inserir supabase-mail (meta:).")

p.write_text(s.replace(marker, service + marker, 1))
PY

echo "supabase-mail adicionado ao compose."
