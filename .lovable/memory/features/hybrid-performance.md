---
name: Hybrid Performance Persistence
description: Painel de Performance (Win Rate, ROI, Entradas) usa tabela hybrid_entries no Supabase com RLS para sincronizar PC e celular. Realtime via supabase channel.
type: feature
---
- Tabela `hybrid_entries` (user_id, match_id, tier, minute, market, stats, da_estimated, result, entry_at, resolved_at).
- RLS: usuário só lê/escreve as próprias entradas; admin lê todas.
- Hook: `useHybridPerformance()` em `src/hooks/useHybridPerformance.tsx` — expõe `performance`, `registerSignal(signal)`, `resolve(id, result, exitMinute)` e atualiza via Supabase realtime.
- Store: `src/lib/hybridStore.ts` — funções `getPerformance`, `registerEntry`, `resolveEntry`, `isBlocked`, `getDailyCount`.
- Limites: máx 5 entradas/dia (UTC-3 / America/Belem), STOP após 2 LOSS consecutivos. Dia calculado em `getTodayInPara()`.
