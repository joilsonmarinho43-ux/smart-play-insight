# Data Coverage Report (atualizado)

Plano: **API-Sports REMOVIDA**. Stack oficial é SportsRC (primária) →
Football-Data.org (secundária) → TheSportsDB (terciária) → cache.

## ⚠️ Limitações do plano FREE da SportsRC

Confirmado em 2026-06-23 via `type=account`:

```
plan: FREE  ·  limit_daily: 1000
```

Endpoints **liberados no FREE**:
- `type=matches` (fixtures por data + status live)
- `type=detail` (placar atual, HT, venue, league, status)
- `type=account`, `type=sports`

Endpoints que retornam **`Access Denied`** (requer plano pago):
- `type=stats` · `type=lineups` · `type=incidents` · `type=h2h`
- `type=standing` · `type=graph` · `type=odds`

Para esses dados, o sistema **deriva** as métricas a partir do que está
disponível (histórico + Poisson + proxies). Quando o usuário fizer
upgrade da chave SportsRC, todas as derivações são substituídas
automaticamente pelos dados reais sem mudar código (basta atualizar
`SPORTSRC_API_KEY`).

## Cobertura por métrica (com plano FREE atual)

| Métrica                  | SportsRC FREE | Football-Data.org | TheSportsDB | Derivada (fallback ativo) |
|--------------------------|:-------------:|:-----------------:|:-----------:|:--------------------------|
| Fixture list (data)      | ✅ matches | ✅ `/v4/matches` | ✅ `eventsday.php` | — |
| Live fixtures + status   | ✅ matches?status=live | ⚠️ limitado | ❌ | — |
| Score + HT score         | ✅ detail | ✅ | ⚠️ | — |
| Venue / estádio          | ✅ detail | ⚠️ | ⚠️ | — |
| Lineups + coach          | 🔒 paid | ❌ | ⚠️ último conhecido | última formação salva |
| Incidents (cards, goals) | 🔒 paid | ❌ | ⚠️ timeline | derivado de placar + HT |
| H2H                      | 🔒 paid | ❌ | ⚠️ matchhistory | últimas N partidas via fixtures |
| Standings                | 🔒 paid | ✅ `/v4/competitions/{id}/standings` | ⚠️ | média móvel de last_matches |
| Graph (xG/momentum)      | 🔒 paid | ❌ | ❌ | `SOT*0.32 + SOff*0.06 + corners*0.04` |
| Shots / SOT              | 🔒 paid | ❌ | ❌ | Poisson sobre histórico |
| Corner kicks             | 🔒 paid | ❌ | ❌ | Poisson sobre histórico |
| Ball possession          | 🔒 paid | ❌ | ❌ | proxy 50/50 + adjust |
| Dangerous Attacks (DA)   | 🔒 paid | ❌ | ❌ | `shots*1.5 + corners*2` (`eliteMetrics.getEffectiveDA`) |
| xG                       | 🔒 paid | ❌ | ❌ | `SOT*0.32 + SOff*0.06 + corners*0.04` |
| Pressure (PI / AP5 / AP10) | 🔒 paid | ❌ | ❌ | `pressureEngine` derivado |
| Goal Risk / Imminent Goal | 🔒 paid | ❌ | ❌ | `liveGoalEngine` (momentum × shotmap_density × incidents) |
| BTTS / Over 2.5 history  | 🔒 paid | ⚠️ via matches | ❌ | agregação manual em `match-stats-resolver` |
| Cards (Y/R)              | 🔒 paid | ❌ | ⚠️ timeline | — |
| Logos / badges           | ✅ matches | ✅ `crest` | ✅ | — |
| Odds                     | 🔒 paid | ❌ | ❌ | Poisson (`eliteMetrics.calculateLiveOddsDeviation`) |

Legenda: ✅ disponível · ⚠️ parcial · 🔒 requer plano pago · ❌ não fornece.

## Impacto nos módulos

| Módulo            | Estado atual                                                   |
|-------------------|----------------------------------------------------------------|
| **Pré-Jogo**      | ✅ Funciona com SportsRC + FD.org (fixtures + standings)        |
| **Scanner PRO**   | ⚠️ Funciona em modo derivado (stats reais ausentes)             |
| **Live Trader**   | ⚠️ Goals/placar reais; shots/DA via Poisson                     |
| **Match Analysis**| ⚠️ Sem lineups/odds em tempo real; usa detail + Poisson         |
| **Bingo VIP PRO** | ✅ Funciona com últimos jogos + Poisson                         |
| **Reading Engine**| ⚠️ Reliability marcado como `limitado` (sem odds/lineups)       |

## Cadeia de fallback (final)

```
SportsRC v2 FREE     ←  fixtures + scores + detail
  ↓ falhou
Football-Data.org    ←  fixtures + standings + competitions
  ↓ falhou
TheSportsDB          ←  metadados + logos + last-event timelines
  ↓ falhou
Cache local (stale)  ←  último recurso
```

## Como destravar stats reais

Atualizar `SPORTSRC_API_KEY` para uma chave do plano **PRO/PLUS** da
SportsRC. Todo o pipeline (`football-api`, `match-context`,
`match-stats-resolver`, engines) já está preparado: os adapters tentam
os endpoints e caem em fallback derivado apenas se receberem
`Access Denied`. Nenhuma mudança de código será necessária.
