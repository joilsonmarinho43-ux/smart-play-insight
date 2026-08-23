---
name: Auto-Mode Server
description: Edge function auto-mode-server — classificação live Over 1.5 FT com tiers SUPER_SNIPER/SNIPER/SEMI, RMA rebalanceado, hard blocks endurecidos, janelas reduzidas
type: feature
---

Edge function `auto-mode-server` envia sinais Over 1.5 FT ao Telegram.

## Tiers (prioridade SUPER > SNIPER > SEMI)
- **SUPER_SNIPER 💀**: 0x0, min 12-28, SoG≥4, DA≥12, corners≥3, posse≥58%, pressão≥75, RMA≥28. Sensitivity: `premium`.
- **SNIPER 🔥**: 0x0, min **8-28**, SoG≥3, posse≥55, DA≥8, corners≥2, pressão≥60. Sensitivity: `agressivo`.
- **SEMI ⚡**: **somente 0x0**, min **8-25** (após 25' não há tempo para 2 gols), SoG≥**3**, posse≥**55**, DA≥**8** **REAL** (não estimado), corners≥**2**, pressão≥**50**. Sensitivity: `moderado`. 🔒 Bloqueia DA estimado + filtro de posse estéril.

## Gate Poisson (0x0 → precisa de 2 gols)
`_shared/goalProjection.ts` calcula xG/min por eventos reais (SoG 0.09, chute fora 0.025, DA 0.012, escanteio 0.022) × fator de pressão, projeta λ até o min 90 e exige P(≥2 gols):
- auto-mode: SUPER ≥55%, SNIPER ≥58%, SEMI ≥62%
- scanner-pro (Over 1.5 FT): ≥60%, além de min ≤25, SoG≥3, DA≥8, pressão≥50, λ≥2.2

## Regra global de valor (Over 1.5)
Nenhum sinal Over 1.5 é enviado com gol já marcado nem após o min 25 — vale para `auto-mode-server` e `scanner-pro-server`. Odds derivadas da própria probabilidade são apenas referência e **não podem bloquear entradas** como se fossem cotações reais da casa.

## Diretriz de refinamento (ago/2026)
- O objetivo é **manter volume com melhor seleção de mercado**, não reduzir sinais por endurecimento indiscriminado.
- A confiança dinâmica deve usar a quantidade de gols exigida pelo mercado: P(≥2) para Over 1.5 em 0x0 e P(≥1) para Over 0.5 HT.
- O ritmo inicial passa por regressão Bayesiana antes da projeção até 90', evitando extrapolação excessiva de amostras curtas.
- Quando HT e FT qualificarem juntos, escolher pelo perfil do jogo: explosão imediata → HT; pressão sustentada → FT.
- DA estimado só sustenta FT quando confirmado por SoG, chutes e escanteios reais.
- Auto Mode e Scanner usam o mesmo RMA compartilhado e enviam pelo mesmo `telegram-signal`; nenhum emissor deve gravar/enviar diretamente por fora do claim central.
- Resultado sem placar real permanece pendente; idade do sinal ou ausência no feed não pode ser convertida em LOSS.


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
