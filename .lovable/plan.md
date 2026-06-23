# Superbet Connect — Captura via Compartilhamento Android

Módulo isolado em `src/modules/superbet-connect/` + edge function `superbet-parse`. **Não altera** Live, Pré-Jogo, Scanner ou Elite — apenas adiciona uma nova fonte ao `DataProvider` quando o usuário envia dados.

## Pré-requisitos (sem isso nada funciona)

1. **Capacitor instalado** no projeto (`@capacitor/core`, `/cli`, `/android`, `/share`, `/camera`, `/filesystem`). Hoje o projeto é só web — vou adicionar a camada Android.
2. Usuário precisa **exportar pro GitHub → `npx cap add android` → Android Studio** para gerar o APK. Lovable não compila APK; só prepara o código.
3. Share Target nativo Android (intent-filter `SEND` para `text/plain`, `image/*`, `application/pdf`).

## Fluxo do usuário

```text
Superbet app ─▶ botão Compartilhar ─▶ "Match Insight Pro"
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
      texto/URL compartilhada       screenshot (PNG/JPG)        múltiplas imagens
              │                           │                           │
              ▼                           ▼                           ▼
       Parser de URL/HTML          OCR (Tesseract.js WASM)     OCR em batch
              │                           │                           │
              └───────────────┬───────────┴───────────────┬───────────┘
                              ▼                           ▼
                      Normalizador (Zod schemas)   Detector de mercado
                                      │
                                      ▼
                      Tabela `superbet_captures` (Lovable Cloud)
                                      │
                                      ▼
               Registrado como `MatchSource` priority=0 (override Superbet)
                                      │
                                      ▼
                      Engines existentes consomem normalmente
```

## Fases

### Fase 1 — Fundação (esta entrega)
- Instalar Capacitor + plugins (`@capacitor/share`, `@capacitor/filesystem`, `@capacitor-community/share-target`).
- `capacitor.config.ts` com appId/appName + hot-reload pro sandbox.
- Página `/superbet-connect` com:
  - Onboarding (passos pra instalar APK).
  - Tela "Aguardando compartilhamento" + área de drop manual (web fallback).
  - Botão "Colar texto da Superbet" (funciona até no web).
- Tabela `superbet_captures` (id, user_id, raw_text, raw_image_url, parsed_json, source_url, market_hint, status, created_at) com RLS por user_id.
- Edge function `superbet-parse` (stub) que aceita `{ text?, imageBase64? }` e devolve JSON normalizado.

### Fase 2 — Parser de texto/URL
- Regex + heurísticas pra extrair: nomes dos times, mercados (Over/Under, Handicap, Escanteios, BTTS), odds (1.xx–999), placar, minuto.
- URL parser: detecta `superbet.bet.br/.../{slug-do-jogo}` e extrai slug → nomes normalizados.
- Schemas Zod por tipo de captura: `OddsBlock`, `StatsBlock`, `H2HBlock`, `LineupBlock`, `IncidentsBlock`.
- Detector de tipo: olha keywords ("escanteios", "finalizações", "posse", "cartões", "H2H", "escalações") e roteia.

### Fase 3 — OCR de screenshots
- Tesseract.js v5 WASM no cliente (sem servidor) com idioma `por+eng`.
- Pré-processamento: grayscale + threshold (Canvas API) pra melhorar leitura de odds.
- ROI detection simples: divide a imagem em bandas e roda OCR por banda.
- Fallback: se OCR cliente <60% confiança, envia base64 pro edge function que chama Gemini Vision (já temos `GEMINI_API_KEY`) com prompt estruturado pedindo JSON.

### Fase 4 — Extratores resilientes (sua spec original adaptada)
- **Nível 1** Parser estruturado de URL/slug Superbet.
- **Nível 2** Regex/keyword matching no texto colado/compartilhado.
- **Nível 3** OCR cliente (Tesseract) → OCR servidor (Gemini Vision).
- **Nível 4** Fallback SportsRC (já existe — só amarrar como último nível).
- Cada nível retorna `{ ok, confidence, data, missingFields[] }`. Orquestrador escolhe maior confiança.

### Fase 5 — Normalização e injeção nos engines
- `superbetNormalize.ts`: mapeia times via `normalizeTeamName` existente, ligas via dicionário interno, mercados pro vocabulário interno (`over_2_5`, `corners_9_5`, etc).
- Registrar `MatchSource { name: 'superbet-shared', priority: 0 }` no `dataProvider/sources.ts` — só dispara quando há captura recente do user pro mesmo jogo.
- Hook `useSuperbetEnrichment(matchId)` que injeta odds/stats no Modal de Leitura e Live.

### Fase 6 — Monitor de mudanças
- Tabela `superbet_parser_health` (parser_version, field, success_count, fail_count, last_fail_sample, last_fail_at).
- Toda captura atualiza contadores por campo. Se `fail_count/(success+fail) > 30%` em 24h → alerta no painel admin (`/admin`) com sample do texto que falhou.
- Reaproveita `dp:health-alert` event + `useDataProviderHealthMonitor` que já existem.
- Versionamento de parser: bumpa `parser_version` quando regex muda → métricas resetam.

## Limitações que você precisa aceitar
- **Não funciona dentro do app web normal** — só no APK Android compilado. No navegador, só a parte de "colar texto" funciona.
- **OCR não é perfeito** — odds estilizadas (com sombra/gradiente) erram ~10–20%. Por isso o fallback Gemini Vision.
- **Superbet pode mudar layout** — por isso fases 4 e 6. Mas mudança grande exige você (ou eu, num pedido novo) ajustar regex.
- **Compilação do APK é fora do Lovable** — Android Studio na sua máquina ou serviço de CI.

## Esta entrega (Fase 1 apenas)

Vou implementar **só a Fase 1** agora pra não despejar 30 arquivos meio-prontos. Você testa a estrutura, valida o fluxo de share, e me dá OK pra seguir pras fases 2–6 uma por vez.

Arquivos criados na Fase 1:
- `capacitor.config.ts`
- `src/modules/superbet-connect/{index.ts, types.ts, config.ts}`
- `src/modules/superbet-connect/components/{SuperbetConnectCard, ShareReceiver, ManualPaste}.tsx`
- `src/modules/superbet-connect/hooks/{useShareTarget, useCaptureStore}.ts`
- `src/pages/SuperbetConnect.tsx` + rota
- `supabase/functions/superbet-parse/index.ts` (stub que ecoa o input + valida shape)
- Migration: tabela `superbet_captures` + RLS + GRANTs
- Item no `AppSidebar` "Superbet Connect" (beta)

Depois você me chama pra Fase 2.
