#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — LEGACY / DESABILITADO
#
# Este script não cria cron jobs. Os broadcasts legados e o
# daily-ticket-settle foram retirados do fluxo operacional.
# A geração/registro de sinais pertence exclusivamente ao Nexus Core.
#
# Mantido apenas para impedir que instalações antigas recriem jobs
# desabilitados acidentalmente.
# =====================================================================
set -euo pipefail

echo "NEXUS 33: broadcasts legados e daily-ticket-settle permanecem DESABILITADOS."
echo "Nenhum pg_cron job foi criado."
exit 0
