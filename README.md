# NEXUS 33 — Analista Joilson

Plataforma de análise de futebol em tempo real com motor quantitativo, contexto de pesquisa e publicação de sinais no Telegram. React + Vite + Supabase Edge Functions.

## Arquitetura atual
- **Frontend**: React 18, Vite 5, TypeScript, Tailwind, shadcn/ui
- **Mobile**: Capacitor (Android) — plugins Kotlin em `native/android/`
- **Backend**: Supabase (Postgres + Edge Functions Deno + pg_cron)
- **Dados**: SportsRC, ESPN público, TheSportsDB e Football-Data.org como fallback quando disponível
- **Modelo quantitativo**: histórico real de equipes → Bayes + Poisson; xG somente quando observado; sem Big Chances → xG
- **IA auditora**: Gemini 2.5 Pro + Google Search para pesquisa contextual; Groq Llama 3.3 70B para auditoria normal; Gemini 2.5 Flash como fallback
- **Decisão**: Nexus Core é a única autoridade de decisão; `MODEL_VALIDATED` significa validação estrutural do modelo e `CALIBRATED` é reservado para calibração empírica
- **Valor de mercado**: somente odd observada; EV nunca é calculado a partir de odd fabricada
- **Notificações**: Telegram Bot API, com gate downstream e ledger

## Rodando local
```bash
bun install
cp .env.example .env
bun run dev
```

## Estrutura
```
src/                       # frontend e motores quantitativo/decisório
supabase/functions/        # edge functions de dados, pesquisa, IA e Telegram
supabase/migrations/       # schema, RLS, cron e funções SQL
native/android/            # plugins Capacitor

docs/                      # documentação técnica
```

## Deploy / migração
- **VPS própria (self-hosted 100%)**: `SELF-HOST.md`
- Migração para outro provedor gerenciado: `DEPLOY.md`

## Segurança analítica
O sistema falha fechado quando faltam amostra histórica, dados essenciais, validação do modelo, odd observada ou auditoria contextual. A IA não cria nem promove probabilidades.

## Portabilidade
Todo o código, schema, cron e edge functions estão versionados neste repositório. Chaves de terceiros ficam em `.env` e Supabase Secrets.
