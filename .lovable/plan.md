## Objetivo
Substituir a API-Football (API-Sports) como fonte principal por 3 APIs gratuitas, mantendo toda a estrutura do app (Pré-Jogo, Live, Scanner, Elite, Bingo, Match Reading) funcionando sem quebrar contratos internos.

## APIs a integrar

1. **Football-Data.org** (token: `abb2fff02b464deeb79e7ba3151c1f9a`)
   - Plano free: 10 req/min, ligas principais (PL, La Liga, Serie A, Bundesliga, Ligue 1, CL, etc.)
   - Header: `X-Auth-Token`
   - Cobertura: pré-jogo (fixtures/scheduled), placares ao vivo (sem stats avançadas)
   
2. **SportsRC / API-Football alternativo** (token: `abb2fff02b464deeb79e7ba3151c1f9a`)
   - Vou validar o endpoint real antes (o domínio "SportsRC" não é canônico — pode ser um proxy de API-Sports). Se token + base URL não responderem, marco como inativa e documento.
   
3. **TheSportsDB v1 free (key `123`)**
   - Já parcialmente integrado em `dataProvider/sources.ts`.
   - Cobertura: eventos do dia, escudos, ligas, sem estatísticas live ricas.

## Estratégia (não-destrutiva)

Mantemos o **Data Provider Unificado** (`src/services/dataProvider/`) como orquestrador. Cada API vira um `MatchSource` com prioridade. A Edge Function `football-api` deixa de ser fonte primária e passa a um modo dormente (fallback opcional via secret), enquanto os novos sources passam a alimentar Pré-Jogo direto do cliente.

```text
Pré-Jogo (Home / Index)
  ├─ 1. football-data-org      (priority 1)  ← novo
  ├─ 2. sportsrc               (priority 2)  ← novo (se endpoint validado)
  ├─ 3. thesportsdb-public     (priority 3)  ← já existe
  └─ 99. stale-local-cache     (último recurso)
```

Live / Scanner / Elite continuam usando a Edge `football-api` até a Fase 2, porque dependem de stats ricas (dangerous attacks, SOT, possession) que **nenhuma das 3 free oferece**. Vou avisar isso claramente.

## Mudanças por arquivo

### Novos
- `src/services/dataProvider/sources/footballDataOrg.ts` — fetch via proxy edge (evita CORS + esconde token).
- `src/services/dataProvider/sources/sportsRc.ts` — idem.
- `supabase/functions/free-football-proxy/index.ts` — proxy único que recebe `{provider, path, params}` e injeta o token correto a partir dos secrets. Centraliza rate-limit e cache curto.

### Editados
- `src/services/dataProvider/sources.ts` — registra os 2 novos sources e re-prioriza.
- `src/services/footballApi.ts` — `fetchMatches` passa a delegar 100% ao Data Provider (remove dependência direta da edge antiga para pré-jogo). `fetchLiveMatches` permanece igual.
- `src/hooks/useApiKeyValidator.tsx` — valida as 3 novas chaves em vez da antiga.
- `src/pages/Index.tsx` — banner offline cita a nova ordem de fontes.
- Secrets via `add_secret`: `FOOTBALL_DATA_ORG_KEY`, `SPORTSRC_KEY` (TheSportsDB usa `123` público — não precisa secret).

### Não tocados
- Live Trader PRO, Scanner PRO server, Elite, Bingo, Match-Analyst — continuam usando API-Sports. Faço uma nota explícita.

## Limitações importantes (vou avisar o usuário)
1. **Stats live (SOT, dangerous attacks, possession, corners ao vivo)** não existem nas 3 APIs gratuitas → Scanner/Elite/Live só funcionam plenamente se a API-Sports voltar.
2. **Football-Data.org** limita a ~12 ligas grandes; jogos de divisões inferiores e amistosos podem sumir.
3. **Rate limit free** (10 req/min) → cache agressivo de 6-12h por data.

## Validação
- Health-check no boot pingando cada provider.
- Painel `/diagnostics` (já existe) mostra qual fonte serviu cada data.
- Teste manual: carrega Home e confirma jogos do dia.

## Fora de escopo (não vou fazer agora)
- Reescrever Scanner/Live para sobreviver sem stats ricas.
- Remover a Edge `football-api` (fica como fallback dormente).
