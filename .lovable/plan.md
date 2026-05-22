## Objetivo

Transformar o modal "📖 Leitura do Jogo" em uma análise pré-jogo premium, contextual e humana, combinando estatísticas internas + contexto externo (escalações, lesões, motivação, clima, odds) + interpretação narrativa profissional.

---

## Arquitetura em 3 camadas

```text
[ Camada 1 - Dados internos ]   →  já temos (Poisson, xG, forma, H2H, médias)
[ Camada 2 - Contexto externo ]  →  nova edge function `match-context`
[ Camada 3 - Interpretação ]     →  novo motor `readingEngine.ts` (texto humano)
```

---

## Camada 1 — Dados Internos (já existe)

Mantém o que `matchReading.ts` já lê: médias ofensivas/defensivas, regressão bayesiana, Poisson, mercados de `analyzeMarkets`, amostra de jogos, escanteios, cartões.

---

## Camada 2 — Contexto Externo (nova edge function)

Criar `supabase/functions/match-context/index.ts` que recebe `{ fixtureId, leagueId, season, homeId, awayId, kickoffISO, venueCity }` e retorna:

```ts
{
  lineups:      { home: {probable, missing[]}, away: {probable, missing[]}, source: 'api-sports'|'estimated' },
  injuries:     { home: Player[], away: Player[], impact: 'baixo'|'médio'|'alto' },
  motivation:   { home: string, away: string, stake: 'título'|'classificação'|'rebaixamento'|'meio-tabela'|'amistoso' },
  fatigue:      { home: {gamesLast10d, restDays, travel}, away: {...} },
  weather:      { tempC, condition, rainMm, wind, pitchImpact: 'normal'|'pesado' } | null,
  oddsMovement: { home: {open, current, drift}, draw, away, over25, btts, signal: 'estável'|'caindo favorito'|'subindo azarão' } | null,
  reliability:  'completo' | 'parcial' | 'limitado'
}
```

Fontes (somente API-Sports, já configurada via secret existente):
- `/fixtures/lineups` → escalações prováveis
- `/injuries?fixture=…` → lesões e suspensões
- `/fixtures/headtohead`, `/teams/statistics`, `/fixtures?team=…&last=10` → desgaste/calendário
- `/odds?fixture=…` (pré-jogo, snapshot atual; comparar com `/odds/live` para detectar drift quando disponível)
- Clima: opcional, só se já houver chave externa; caso contrário retorna `null` e a interpretação ignora a seção.

A função tem cache em `cache_api` (chave `ctx:{fixtureId}`, TTL 30 min) seguindo o padrão atual.

---

## Camada 3 — Interpretação Humana (novo motor)

Criar `src/lib/readingEngine.ts` que recebe `MatchData` + `MatchContext` e devolve `MatchReadingV2` com 10 seções:

```ts
interface MatchReadingV2 {
  summary: string;             // 1. Resumo contextual humano
  tactical: string;            // 2. Leitura tática
  indicators: string[];        // 3. Indicadores RELEVANTES (filtrados)
  marketRead: string;          // 4. Leitura do mercado (valor/armadilhas)
  opportunities: Opportunity[];// 5. Melhores oportunidades
  alerts: string[];            // 6. Alertas inteligentes
  likelyScores: string[];      // 7. Placares prováveis (Poisson + ajuste contexto)
  timing: { pressure, acceleration, opening };  // 8. Timing
  predictability: 'verde' | 'amarelo' | 'vermelho'; // 9. Nível
  verdict: string;             // 10. Veredito final
  contextQuality: 'completo' | 'parcial' | 'limitado';
}
```

Geração do texto:
- Templates compostos por fragmentos variáveis (não repetitivos) baseados em faixas reais: `λ_total`, diferença `home-away`, `BTTS%`, `Over2.5%`, `impacto_lesoes`, `motivacao`, `drift_odds`.
- Cada seção monta a frase a partir do **estado real** dos dados — sem placeholders genéricos. Se contexto externo não veio, a leitura usa só Camada 1 e marca `contextQuality: 'limitado'`.
- Proibido: "IA", "algoritmo", "robô", "Poisson", "λ", "regressão". Texto soa como analista humano.
- Veredito final usa árvore de decisão simples: combina favoritismo real × valor de odd × confiabilidade de contexto.

Nível de previsibilidade:
- 🟢 verde: amostra ≥5, lesões impacto baixo, odds estáveis, λ_total coerente
- 🟡 amarelo: amostra parcial OU lesões médias OU drift moderado
- 🔴 vermelho: contexto limitado OU lesões altas em titulares OU drift forte

---

## Frontend

- `MatchReadingModal.tsx`: reescrito para renderizar as 10 seções do `MatchReadingV2`, mantendo o tema escuro atual e tipografia já em uso. Badge de previsibilidade (🟢🟡🔴) no topo + chip de `contextQuality`.
- `MatchCard.tsx`: o botão "📖 Leitura do Jogo" já existe; passa a chamar um hook `useMatchReading(match)` que:
  1. busca contexto via `supabase.functions.invoke('match-context', …)` (cache local 30 min)
  2. monta a leitura com `buildReadingV2(match, context)`
  3. retorna estado `{ loading, reading, error }`
- Skeleton enquanto carrega o contexto.

---

## Entregáveis

```text
supabase/functions/match-context/index.ts       (NEW)
src/lib/readingEngine.ts                         (NEW - substitui matchReading.ts)
src/hooks/useMatchReading.tsx                    (NEW)
src/components/MatchReadingModal.tsx             (REWRITE - 10 seções)
src/components/MatchCard.tsx                     (pequeno: usar o novo hook)
src/lib/matchReading.ts                          (DEPRECATE / re-export para compat)
```

Sem mudanças no Live, no Bingo, no Scanner ou em qualquer engine existente.

---

## Pontos a confirmar antes de codar

1. **Clima**: não há conector de clima configurado hoje. Posso (a) deixar a seção opcional e omitir quando ausente, ou (b) você adiciona uma chave OpenWeather. Sigo com (a) por padrão.
2. **Movimento de odds**: API-Sports devolve apenas snapshot pré-jogo por casa; o "drift" será calculado comparando snapshots em cache (primeira leitura = baseline). Aceitável?
3. **Custo de API**: cada abertura do modal pode disparar 3–4 calls (lineups, injuries, fixtures recentes, odds). O cache de 30 min em `cache_api` mitiga, mas confirma se posso adicionar essa carga.
