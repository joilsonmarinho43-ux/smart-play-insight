---
name: Auto-Mode Server
description: Edge function auto-mode-server — classificação live Over 1.5 FT com tiers SUPER_SNIPER/SNIPER/SEMI, RMA rebalanceado, league_weight e momentum
type: feature
---

Edge function `auto-mode-server` envia sinais Over 1.5 FT ao Telegram.

## Tiers (prioridade SUPER > SNIPER > SEMI)
- **SUPER_SNIPER 💀**: 0x0, min 12-28, SoG≥4, DA≥12, corners≥3, posse≥58%, pressão≥75, RMA score≥28. Confidence: `min(98, 82 + pressão/8 + filtros×2)`. Sensitivity: `premium`.
- **SNIPER 🔥**: 0x0, min 5-30, SoG≥3, posse≥55, DA≥8, corners≥2, pressão≥60. Sensitivity: `agressivo`.
- **SEMI ⚡**: 0x0 min 5-30 OU 1x0/0x1 min 5-45, SoG≥1, posse≥50, DA≥4, corners≥1, pressão≥30. Sensitivity: `moderado`.

## RMA (rebalanceado)
`score = pressão×0.30 + ap_norm×0.35 + f_norm×0.15 + sot_norm×0.20 + leagueWeight + momentumDelta`
Bloqueia se `ap_norm<1.5`, `pressão>60 && da=0`. NEUTRO se `sot_norm=0`. CONFIRMADO se score>40.

## League weight
- Elite (Premier, La Liga, Serie A, Bundesliga, Ligue 1, Champions): **+5**
- Instáveis (amistoso, reservas, sub-XX, youth, women, amateur): **−5**
- Demais: 0

## Momentum (últimos ~5 min)
Cache em memória (`momentumCache`) por matchId. Delta = `dSog×2 + dCorners×1.5 + dDa×0.25 + dPressure×0.05`, clamp ±6, mínimo ±3 quando relevante. Aplicado tanto no RMA score quanto na confidence final.

## Mantido (NÃO alterar)
- Mercado fixo Over 1.5 FT
- 1 sinal por jogo/dia
- Máximo 25 sinais/dia
- Fallback DA estimado (`totalShots×1.5 + corners×2`)
- Logs em `rma_shadow_logs`
- Integração `telegram-signal` + `calibrationEngine`
