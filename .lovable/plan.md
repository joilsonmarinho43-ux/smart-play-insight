# Refatoração final: remover API-Sports da camada de dados

## Escopo
Eliminar completamente a API-Sports (provider, edge function, secrets, fallbacks, health checks) e migrar todos os engines (match-analysis, reading, scanner, live-goal, pressure, bingo) para a stack:

1. **SportsRC** (primária — fixtures, stats, incidents, h2h, lineups, graph)
2. **Football-Data.org** (secundária — fixtures, standings, competitions)
3. **TheSportsDB** (terciária — metadados, logos, last events)
4. **Cache local** (último recurso)

## Mudanças

### 1. Remoções
- `supabase/functions/football-api/` (deletar — era proxy API-Sports)
- Source `football-api-edge` em `src/services/dataProvider/sources.ts`
- Função `fetchMatches` em `src/services/footballApi.ts` (e arquivo todo, se só esse uso)
- Secret `API_FUTEBOL_KEY` (delete_secret) e referências
- Validações/health checks de API-Sports em `useApiKeyValidator.tsx` e `useDataProviderHealthMonitor.ts`
- Chamadas diretas a `footballApi.ts` nos engines/páginas (substituir por `getMatchesByDate` ou `match-stats-resolver`)

### 2. Edge functions a atualizar (remover API-Sports, usar SportsRC)
- `match-stats-resolver` — já tem SportsRC; remover branch API-Sports
- `scanner-pro-server` — migrar para SportsRC (`type=matches&status=live` + `type=stats&id=`)
- `auto-mode-server` — idem
- `match-analyst`, `match-context` — usar SportsRC `type=detail|stats|h2h|standing`
- `healthcheck` — checar SportsRC + Football-Data.org + TheSportsDB

### 3. Engines client-side
- `pressureEngine.ts`, `eliteMetrics.ts`, `liveGoalEngine.ts`, `readingEngine.ts`, `scannerEngine.ts`, `bingoEngine.ts`, `matchAnalysis.ts` — confirmar que recebem `LiveStats` puro (já são agnósticos ao provider). Adaptar mappers em `sportsrc.ts` para entregar o shape esperado (shotsOnGoal, totalShots, corners, possession, dangerousAttacks, xG).

### 4. Métricas derivadas (quando SportsRC/FD.org/TSDB não fornecem)
| Métrica | Fonte direta | Derivação se ausente |
|---|---|---|
| Dangerous Attacks | SportsRC `stats` | `shots*1.5 + corners*2` (já existe em eliteMetrics) |
| xG | SportsRC `graph` | `shotsOnTarget*0.32 + shotsOff*0.06 + corners*0.04` |
| Pressão (PI) | derivada | `stats + incidents + graph` (engine atual) |
| Momentum | SportsRC `graph` series | janela móvel 5min sobre attacks/shots |
| Força ofensiva | derivada | `xG*0.5 + shots/jogo*0.3 + standing.goalsFor*0.2` |
| Risco de gol | derivada | `momentum*0.4 + shotmap_density*0.4 + incidents.recent*0.2` |
| BTTS / Over | derivada | agregação de `last_matches` + `h2h` (já feita) |

### 5. Relatório de cobertura
Criar `docs/data-coverage.md` com tabela métrica × fornecedor × derivação.

### 6. Prioridades em `sources.ts`
```ts
registerSource({ name: 'sportsrc',         priority: 1, fetchByDate: fetchSportsRC });
registerSource({ name: 'football-data-org',priority: 2, fetchByDate: fetchFootballDataOrg });
registerSource({ name: 'thesportsdb-public',priority: 3, fetchByDate: fetchTheSportsDB });
// stale-cache local fica em prioridade 99 (último recurso)
```

## Validação
- Build limpo (sem imports quebrados de `footballApi`).
- `probeAllSources(today)` retorna 3 fontes, nenhuma `api-sports`.
- Healthcheck edge function responde OK para as 3 novas fontes.
- Pré-Jogo, Scanner, Live Trader e Bingo continuam carregando dados.

## Riscos
- Scanner/Live dependem de `dangerousAttacks` e SOT em tempo real. SportsRC fornece via `type=stats&id={match_id}` mas custa 1 req por jogo. Mitigação: batching de 3 jogos em paralelo + cache 90s (mesma política atual).
- Se SportsRC `type=stats` não entregar SOT em alguma liga, fallback usa derivação Poisson já implementada no `eliteMetrics.ts` (proxy DA).

Aprovar para eu executar tudo de uma vez.
