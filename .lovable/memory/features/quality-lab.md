---
name: Quality Lab
description: Painel admin /quality com analytics de sinais (winrate/ROI/streaks/horários/ligas/mercados/estratégias) e sugestões automáticas. Não altera engines.
type: feature
---

- Rota `/quality` (admin-only). Sidebar entry "Quality Lab" (ícone Activity).
- RPC `get_signal_analytics(p_days int)` retorna jsonb com overall, by_market, by_strategy, by_hour, by_minute_window, by_league, daily, recent_results. Admin gate dentro da função.
- Tabela `signal_suggestions` (category, subject, severity, metric, message, payload, status). RLS admin-only.
- Função `detect_signal_degradation()` compara 7d vs 30d anteriores; cria sugestões quando winrate cai >15pp (sample ≥10) ou ROI < -5% (sample ≥20). Roda no cron diário `ops-detect-degradation-daily` (04:00 UTC).
- `telegram_signals` ganhou colunas `league`, `quality_score`, `quality_breakdown` (livre para uso futuro pelos engines, opcionais).
- Princípio: nunca altera thresholds automaticamente — só sugere. Anti-overfitting preservado.
