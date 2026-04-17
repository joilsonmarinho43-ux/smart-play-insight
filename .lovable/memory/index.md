# Memory: index.md
Updated: now

# Project Memory

## Core
- **Stack**: React, Tailwind, Supabase Edge Functions. No Lovable references. Brand: 'Analista Joilson'.
- **Design**: Sporty dark, orange/gold on navy/black. Bebas Neue (titles), Inter/Roboto. Numbers `.toFixed(1)`.
- **Live Isolation**: Live Module is STRICTLY ISOLATED. Changes must not affect pre-game/predictions or global structure.
- **Data Integrity**: Use real API-Sports metrics only (no generic/fabricated data).
- **Timezone**: Tudo em UTC-3 (America/Belem) — usar helpers em `src/lib/timezone.ts`.
- **Home**: SOMENTE pré-jogo. Scanner PRO e Elite ficam em /scanner e /elite (acessados pela sidebar).
- **Admin**: `joilsonmarinho08@gmail.com`

## Memories
- [Hybrid Performance](mem://features/hybrid-performance) — Tabela hybrid_entries no Supabase, hook useHybridPerformance, sincroniza PC/celular
- [Hybrid DA Fallback](mem://logic/hybrid-da-fallback) — DA estimado quando API=0, trava de chute/escanteio nos últimos 10min
- [Timezone Pará](mem://preference/timezone-para) — UTC-3 America/Belem em todo o app
- [Target Leagues](mem://config/target-leagues) — 6 elite pre-game leagues, 22 Live Trader PRO leagues
- [Subscription & Trial](mem://auth/trial-subscription-logic) — 3-day free trial, R$50/mo paywall, WhatsApp renewal link
- [Session Security](mem://auth/security) — Single session persistence via `useSessionGuard`, admin exempt
- [Style Guide](mem://style/guide) — Visual identity, bg-circuit-pattern.jpg, typography and colors
- [API Performance Limits](mem://constraints/performance-limits) — 120 reqs/exec, batches of 3, 150ms delay
- [Cache Strategy](mem://api/cache-strategy) — TTL rules: LIVE 2m, PRE 12h, Finished permanent, Team stats 24h
- [Database Maintenance](mem://database/maintenance) — pg_cron routines for session conflicts and cache_api cleanup
- [Data Integrity](mem://logic/integrity) — Pre-game filters for 'NS' matches, cache staleTime 10 min
- [Combo Signal](mem://logic/combo-signal) — Over 2.5 Goals & Over 7.5 Corners > 85% probability logic
- [Odd Estimation](mem://logic/odd-estimation) — EV+ and Stake calculation with 8% safety margin
- [Betting Logic](mem://logic/betting) — Risk profiles (Con 75%, Mod 65%, Agg 55%) and Opportunity Score formula
- [Analysis Engine](mem://logic/analysis-engine) — Poisson (60%) + xG (40%), Bayesian regression (k=3), xG proxy 0.22
- [Bingo VIP PRO](mem://features/bingo) — 10 markets, Poisson + xG, 45% HT / 55% FT, ≥ 72% confidence
- [Elite Performance](mem://logic/elite-performance) — VIP matches ≥ 2h advance, APM ≥ 0.8 threshold
- [Scanner PRO](mem://features/scanner-pro) — Top 10 opps (Prob ≥ 60%, EV > 0), Live 15 mins filters
- [Live Trader PRO UI](mem://features/live-trader-pro) — Pixel-Perfect grid, PI DIFF OHLC chart
- [Live Trader Metrics](mem://logic/live-trader-metrics) — Danger Index formula, Poisson Over Goals, Momentum chart
- [Live Scanner Alerts](mem://logic/live-scanner-alerts) — Maximum Alert: pressure > 70, SOT >= 4, time >= 20
- [HT/FT Strategy](mem://logic/ht-ft-strategy) — Strategy based on score, AP5/AP10 pressure, possession
- [Match Favorites](mem://features/match-favorites) — LocalStorage favorites for Live dashboard
- [Layout Sidebar](mem://ui/layout-sidebar) — AppSidebar branding, gold/black gradient, 'Modelo Real Pro'
