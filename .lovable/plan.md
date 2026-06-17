
# Fallback Estatístico Inteligente

Sistema que mantém o app funcionando quando API-Football falha, usando cache, histórico no banco e TheSportsDB — sem nunca inventar dados.

## 1. Banco de dados (1 migração)

**Nova tabela `match_stats_fallback`** — estatísticas normalizadas de qualquer fonte:

- `match_id` (text, unique) · `home_team` · `away_team` · `league` · `kickoff_at`
- Estatísticas: `avg_goals`, `avg_corners`, `btts_pct`, `over05_pct`, `over15_pct`, `over25_pct`, `over35_pct`, `clean_sheets_pct`
- Forma: `home_form` (text "WWDWL"), `away_form`
- H2H: `h2h_json` (jsonb)
- Meta: `source` ('api-football' | 'thesportsdb' | 'historical' | 'mixed'), `confidence_score` (int 0-100), `raw_payload` (jsonb)
- Timestamps + índice por `match_id` e `kickoff_at`
- RLS: leitura `authenticated`, escrita só `service_role`

**Nova tabela `fallback_logs`** — observabilidade:
- `source_used`, `latency_ms`, `cache_hit`, `api_football_failed`, `signals_generated`, `created_at`
- RLS: leitura admin

## 2. Edge function `match-stats-resolver` (nova)

Orquestra a cascata na ordem do briefing:

```text
1) cache_api (TTL por tipo: jogos do dia 6h, classificação 24h,
              stats históricas 7d, H2H 30d)
2) match_stats_fallback no banco (se < TTL)
3) API-Football (via football-api existente) — fonte primária quando viva
4) TheSportsDB (lookuptable/eventslast/eventsh2h) — fallback
5) Histórico no banco (qualquer idade) — último recurso
```

A cada sucesso: normaliza para o schema padrão, grava em `match_stats_fallback` com `source` e `confidence_score`, atualiza `cache_api`, registra em `fallback_logs`.

**Score de confiança:**
- 100 = API-Football fresh
- 90 = TheSportsDB completo (todos campos preenchidos)
- 80 = misto (TheSportsDB + histórico)
- 70 = só histórico
- < 70 = retorna `lowConfidence: true` e bloqueia geração automática de sinais

## 3. Integração com código existente

- **`src/services/dataProvider`** — já tem cascata para listagem de jogos; adicionar campo `__confidence` por jogo vindo do resolver.
- **`useMatchReading` / `match-analyst`** — antes de chamar a IA, busca stats pelo resolver; passa `confidence_score` no prompt. IA recebe instrução explícita: "use APENAS números fornecidos; se um campo estiver ausente, diga 'sem dado'".
- **`auto-mode-server` / `scanner-pro-server` / `bingoEngine`** — antes de emitir sinal automático, ler `confidence_score`. Se < 70, pular sinal e logar em `fallback_logs.signals_generated=0`.
- **UI (Home, Bingo, Elite, Scanner, MatchReadingModal)** — badge discreto "Confiança: 80%" quando < 100, e aviso amarelo "Baixa confiança — dados parciais" quando < 70.

## 4. Cache inteligente

Reaproveitar `cache_api` (já existe) com chaves novas e TTL por tipo:
- `mstats_day_{date}` → 6h
- `mstats_standings_{leagueId}` → 24h
- `mstats_team_{teamId}` → 7d
- `mstats_h2h_{homeId}_{awayId}` → 30d

## 5. Garantias

- API-Football continua sendo a fonte primária — nada muda quando ela funciona.
- IA nunca inventa: prompts do `match-analyst` ganham guard rail explícito.
- Toda escrita registra origem em `source`; auditável no painel Admin.
- TheSportsDB é a única fonte alternativa nesta fase (estável, sem scraping).

## Detalhes técnicos

- Mapeamento TheSportsDB → schema padrão: `eventsh2h.php` para H2H, `eventslast.php?id={teamId}` para forma (últimos 5), `lookuptable.php?l={leagueId}` para classificação. Cálculo de `avg_goals` = média de gols nos últimos 5 jogos. Campos não cobertos pelo TheSportsDB (xG, escanteios detalhados) ficam `null` — IA tratará como "sem dado".
- `confidence_score` calculado por % de campos não-nulos × peso da fonte.
- TTLs aplicados via `ultima_atualizacao` em `cache_api` + nova coluna lógica no resolver.
- Sem novas dependências npm.

## Fora de escopo (fases futuras)

- SofaScore/FlashScore/FootyStats/Forebet (sem API oficial — só scraping; recusado).
- Live Trader PRO (live exige dados em tempo real; fallback histórico seria enganoso).
- SportMonks/RapidAPI (aguardando você indicar se tem chave).
