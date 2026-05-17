---
name: Signal Context Intelligence
description: Camada de inteligência contextual — rastreia comportamento dos sinais entre emissão e resultado. Tabela signal_tracking, edge function signal-context-tracker (cron 3min), página admin /context, classificação comportamental e padrões estratégicos.
type: feature
---

## Componentes

- **Tabela `signal_tracking`** (admin-only RLS): 1 linha por sinal (PK signal_id). Guarda snapshots (até 30), agregados de pressão (entry/peak/min/avg/std/drop_pct), goals_after, first_goal_minute, time_to_goal_sec, behavior_class, finalized.
- **Edge function `signal-context-tracker`** (cron `*/3 * * * *`): lê `telegram_signals success=true` últimas 130min; usa cache_api `live_all` (NÃO chama API externa); appenda snapshot por minuto novo; finaliza quando `result` resolvido OU idade > 125min; classifica comportamento.
- **RPC `get_signal_context_analytics(p_days)`**: agrega por behavior, entry_window (0-14/15-29/...75+), liga, mercado. Admin-only.
- **`detect_context_patterns()`** (cron diário 04:15 UTC): gera sugestões em `signal_suggestions`:
  - Entradas <20min com WR<45% → warning early_entry_low_wr
  - Entradas 65+ com WR>70% → info late_entry_high_wr
  - Liga com >30% fake_pressure → warning high_fake_pressure
  - Mercado com tempo médio >25min e WR>65% → info late_resolution_market

## Classes comportamentais

explosivo, consistente, tardio, precoce, fake_pressure, pressao_sustentavel, alta_volatilidade, dead_after_entry, neutro, insuficiente.

Fórmula de pressão simplificada (apenas para tracking, NÃO substitui pressureEngine):
`pressure = SOT*4 + DA*0.55 + corners*2 + totalShots*0.8` por lado, soma como proxy.

## Princípio

Somente OBSERVA. Não altera nenhum engine (scanner/pressure/rma/bingo/htft) nem thresholds. Sugestões aparecem no Quality Lab (`/quality`) e analytics em `/context`.
