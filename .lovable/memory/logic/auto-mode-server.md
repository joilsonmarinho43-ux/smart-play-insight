---
name: Auto-Mode Server
description: Edge function auto-mode-server — classificação live Over 1.5 FT com tiers SUPER_SNIPER/SNIPER/SEMI, RMA rebalanceado, hard blocks endurecidos, janelas reduzidas
type: feature
---

Edge function `auto-mode-server` envia sinais Over 1.5 FT ao Telegram.

## Tiers (prioridade SUPER > SNIPER > SEMI)
- **SUPER_SNIPER 💀**: 0x0, min 12-28, SoG≥4, DA≥12, corners≥3, posse≥58%, pressão≥75, RMA≥28. Sensitivity: `premium`.
- **SNIPER 🔥**: 0x0, min **8-28**, SoG≥3, posse≥55, DA≥8, corners≥2, pressão≥60. Sensitivity: `agressivo`.
- **SEMI ⚡**: 0x0 ou 1x0/0x1, min **8-35** (não aceita HT/2ºT), SoG≥**2**, posse≥**52**, DA≥**5** **REAL** (não estimado), corners≥1, pressão≥**35**. Sensitivity: `moderado`. 🔒 Bloqueia DA estimado + 🔒 **Filtro de posse estéril**: se min≥20 e posse≥60% sem penetração (SIB≥2 OR BS≥2 OR SoG≥2) OU DA/Attacks<0.35 → bloqueia. Bypass quando SoG≥3 ou pressão≥70 (preserva sensibilidade em jogos intensos).

## RMA + Hard Blocks
`score = pressão×0.30 + ap_norm×0.35 + f_norm×0.15 + sot_norm×0.20 + leagueWeight + momentumDelta`

Hard blocks (em ordem):
1. `pressure>70 && SoG≤2 && daEstimated` → BLOQUEADO (pressão fake premium endurecida)
2. `sot_norm < 0.6` → BLOQUEADO (sem finalização real por minuto)
3. `ap_norm<1.5` → BLOQUEADO
4. `pressure>60 && da=0` → BLOQUEADO
5. `sot_norm=0` → NEUTRO

Verdict final: score>40 CONFIRMADO, ≥20 NEUTRO, <20 BLOQUEADO.

## League weight
- Elite (Premier, La Liga, Serie A, Bundesliga, Ligue 1, Champions): **+5**
- Instáveis (amistoso, reservas, sub-XX, youth, women, amateur): **−5**

## Momentum
Cache em memória, delta vs ~5 min atrás. **Boost positivo só conta se SoG≥3** (evita inflar confidence com pressão fake). Confidence cap em 95.

## Calibração baseada em histórico real
- min 45 (HT) e min ≥ 38 → 56-67% acerto → **excluídos do SEMI**
- min ≥ 50 (2º tempo) → 38% acerto → **excluídos**
- min 8-35 → ~78% acerto → **zona dourada**

## Mantido (NÃO alterar)
- Mercado fixo Over 1.5 FT, 1 sinal/jogo/dia, máx 25/dia
- Fallback DA estimado (`totalShots×1.5 + corners×2`)
- Logs em `rma_shadow_logs`, integração `telegram-signal` + `calibrationEngine`
