# NEXUS 33 — Analista Joilson

Plataforma de análise de futebol em tempo real com envio automático de sinais
para o Telegram. React + Vite + Supabase Edge Functions.

## Stack
- **Frontend**: React 18, Vite 5, TypeScript, Tailwind, shadcn/ui
- **Mobile**: Capacitor (Android) — plugins Kotlin em `native/android/`
- **Backend**: Supabase (Postgres + Edge Functions Deno + pg_cron)
- **Dados**: SportsRC (primária), Football-Data.org, TheSportsDB, ESPN público
- **IA**: Lovable AI Gateway (Gemini / Groq como fallback)
- **Notificações**: Telegram Bot API

## Rodando local
```bash
bun install
cp .env.example .env       # preencher VITE_SUPABASE_URL + PUBLISHABLE_KEY
bun run dev                # http://localhost:8080
```

## Estrutura
```
src/                       # frontend (páginas, componentes, engines de análise)
supabase/functions/        # 25 edge functions (auto-mode, scanner, telegram, etc.)
supabase/migrations/       # 41 migrations (schema, RLS, cron, funções SQL)
native/android/            # plugins Capacitor (overlay Superbet)
.lovable/                  # memórias do agente (documentação viva)
docs/                      # documentação técnica
```

## Deploy / migração de hospedagem
Guia completo em **[DEPLOY.md](./DEPLOY.md)**.

## Portabilidade
100% do código, schema, cron e edge functions estão versionados neste repositório.
Somente as chaves de terceiros ficam em `.env` (frontend) e Supabase Secrets
(backend). Ver `.env.example` e DEPLOY.md.
