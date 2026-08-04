#!/usr/bin/env bash
# =====================================================================
# Sincroniza as edge functions do repositório para o edge-runtime
# self-hosted, preservando (ou criando) o router "main" — sem ele o
# container "functions" do Supabase self-hosted não sobe.
#   bash deploy/sync-functions.sh
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEST="supabase-docker/volumes/functions"
mkdir -p "$DEST"

# 1. limpa apenas as funções do projeto (mantém o router "main")
for d in "$DEST"/*/; do
  [ -d "$d" ] || continue
  [ "$(basename "$d")" = "main" ] && continue
  rm -rf "$d"
done

# 2. copia funções + _shared
cp -r supabase/functions/* "$DEST"/

# 3. garante o router "main" (versão do compose oficial do Supabase)
if [ ! -f "$DEST/main/index.ts" ]; then
  mkdir -p "$DEST/main"
  cat > "$DEST/main/index.ts" <<'TS'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (req: Request) => {
  const url = new URL(req.url)
  const { pathname } = url
  const name = pathname.replace(/^\/+/, '').split('/')[0]

  if (!name || name === 'favicon.ico') {
    return new Response(JSON.stringify({ message: 'edge runtime ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const servicePath = `/home/deno/functions/${name}`

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 256,
      workerTimeoutMs: 400_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    })
    return await worker.fetch(req)
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e), function: name }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
TS
  echo "Router 'main' criado."
fi

echo "Edge functions sincronizadas em $DEST ($(ls -d "$DEST"/*/ | wc -l) pastas)."
