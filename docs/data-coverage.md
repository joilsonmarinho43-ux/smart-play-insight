# Data Coverage Report

Plano: **API-Sports REMOVIDA**. Stack oficial é SportsRC (primária) →
Football-Data.org (secundária) → TheSportsDB (terciária) → cache.

## Cobertura por métrica

| Métrica                  | SportsRC v2 | Football-Data.org | TheSportsDB | Derivada (fallback) |
|--------------------------|:-----------:|:-----------------:|:-----------:|:--------------------|
| Fixture list (data)      | ✅ `type=matches&date=` | ✅ `/v4/matches?dateFrom=&dateTo=` | ✅ `eventsday.php` | — |
| Live fixtures            | ✅ `type=matches&status=live` | ⚠️ limitado | ❌ | — |
| Score + status           | ✅ | ✅ | ⚠️ delay | — |
| Lineups                  | ✅ `type=lineups&id=` | ❌ | ⚠️ parcial | última formação conhecida |
| Incidents (cards, goals) | ✅ `type=incidents&id=` | ❌ | ⚠️ `lookuptimeline.php` | — |
| H2H                      | ✅ `type=h2h&id=` | ❌ | ⚠️ `lookupmatchhistory.php` | — |
| Standings                | ✅ `type=standing&id=` | ✅ `/v4/competitions/{id}/standings` | ⚠️ | média móvel de last_matches |
| Graph (xG/momentum)      | ✅ `type=graph&id=` | ❌ | ❌ | `shots_on*0.32 + shots_off*0.06 + corners*0.04` |
| Shots / Shots on target  | ✅ `type=stats&id=` | ❌ | ❌ | — |
| Corner kicks             | ✅ `type=stats&id=` | ❌ | ❌ | — |
| Ball possession          | ✅ `type=stats&id=` | ❌ | ❌ | — |
| Dangerous Attacks (DA)   | ⚠️ se disponível | ❌ | ❌ | `shots*1.5 + corners*2` (já em `eliteMetrics.getEffectiveDA`) |
| xG (expected goals)      | ⚠️ `graph` parcial | ❌ | ❌ | `SOT*0.32 + SOff*0.06 + corners*0.04` |
| Pressure Index (PI / AP5 / AP10) | ❌ direto | ❌ | ❌ | `pressureEngine` derivado de stats+incidents+graph |
| Offensive Strength       | ⚠️ parcial | ✅ standings.goalsFor | ❌ | `xG*0.5 + shotsAvg*0.3 + standings.goalsFor*0.2` |
| Goal Risk / Imminent Goal | ❌ direto | ❌ | ❌ | `momentum*0.4 + shotmap_density*0.4 + incidents.recent*0.2` (`liveGoalEngine`) |
| BTTS / Over 2.5 history  | ⚠️ via h2h+last_matches | ❌ | ❌ | agregação manual (já em `match-stats-resolver`) |
| Cards (Y/R)              | ✅ `incidents` | ❌ | ⚠️ timeline | — |
| Logos / badges           | ✅ | ✅ `crest` | ✅ | — |
| Odds                     | ✅ `type=odds&id=` | ❌ | ❌ | Poisson derivado (`eliteMetrics.calculateLiveOddsDeviation`) |

## Métricas removidas (não há mais fornecedor)

Nenhuma. Todas as métricas usadas pelos engines do app permanecem
disponíveis — diretamente da SportsRC ou via derivações já presentes
no código (`pressureEngine`, `eliteMetrics`, `liveGoalEngine`,
`readingEngine`, `bingoEngine`).

## Cadeia de fallback

```
SportsRC v2          ←  primária
  ↓ falhou / sem dado
Football-Data.org    ←  fixtures + standings
  ↓ falhou / sem dado
TheSportsDB          ←  metadados + logos
  ↓ falhou / sem dado
Cache local (stale)  ←  último recurso
```

Cada engine recebe `LiveStats` puro (shape em `src/lib/pressureEngine.ts`)
e não conhece o fornecedor — toda tradução fica no `football-api` edge
adapter e em `src/services/dataProvider/sources/*`.
