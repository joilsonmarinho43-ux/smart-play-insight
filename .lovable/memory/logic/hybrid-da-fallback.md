---
name: Hybrid DA Fallback & 10min Safety Lock
description: hybridEngine usa fallback DA = totalShots*1.5 + corners*2 quando API zera, e exige ≥1 chute/escanteio NOVO nos últimos 10 min para SNIPER/SEMI.
type: logic
---
- Fallback DA aplicado em `extractStats()` quando `dangerousAttacks === 0` e há shots/corners. Marcado em `signal.daEstimated = true`.
- Trava de segurança: `hasRecentEvent(matchId, minute)` compara snapshot atual com baseline do minuto (current - 10). Exige delta ≥ 1 em totalShots OU corners.
- Aplicada apenas quando `minute >= 15` (jogos jovens não têm histórico suficiente).
- SNIPER e SEMI são DESCARTADOS se a trava falhar; NORMAL ignora a trava (é só sugestão).
- Histórico de snapshots fica em memória (`SNAPSHOT_HISTORY` por matchId, máx 30 entradas).
