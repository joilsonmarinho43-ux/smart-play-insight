# NEXUS 33 — Deploy do zero em nova hospedagem

Reconstrói 100% do sistema a partir de: **repositório GitHub + chaves das APIs
externas**. Nenhum recurso vive apenas na hospedagem atual.

---

## Pré-requisitos
- Node 20+ e `bun` (ou `npm`)
- Supabase CLI: `npm i -g supabase`
- Conta Supabase (grátis) OU novo projeto Lovable Cloud
- Chaves de terceiros: SportsRC, Football-Data.org, Telegram Bot, (opcional) Lovable AI / Gemini / Groq

---

## 1. Clone e build local
```bash
git clone <repo> nexus33 && cd nexus33
bun install                  # ou: npm ci
cp .env.example .env         # preencher com URL + publishable key do NOVO projeto
bun run build                # gera dist/
```

## 2. Criar projeto Supabase novo
1. Criar projeto em https://supabase.com/dashboard (região preferível: `sa-east-1`).
2. Copiar **Project Ref**, **URL**, **anon key** e **service_role key**.
3. `supabase login` e `supabase link --project-ref <NEW_REF>`.

## 3. ⚠️ Ajuste OBRIGATÓRIO nas migrations de cron
As migrations abaixo têm a URL do projeto Supabase e o `anon key` **hardcoded**
(padrão recomendado pelo Supabase para `pg_cron` + `pg_net`). Antes de rodar
`db push`, substitua em massa:

```bash
# Substituir o project ref antigo pelo novo em TODAS as migrations
OLD=yeyctdphzrmyxgskehru
NEW=<NEW_PROJECT_REF>
sed -i "s/${OLD}/${NEW}/g" supabase/migrations/*.sql

# Substituir o anon key antigo pelo novo (procurar em cada arquivo listado)
grep -l "eyJhbGciOi" supabase/migrations/*.sql
# editar cada um manualmente trocando o token JWT antigo pelo novo anon key
```

Arquivos afetados (cron): `20260423013404`, `20260424231235`, `20260504000255`,
`20260516031802`, `20260516032254`, `20260412005743`.

## 4. Aplicar schema + policies + cron
```bash
supabase db push             # aplica as 41 migrations em ordem
```
Isso cria: 21 tabelas, RLS + GRANTs, ~25 funções `security definer`,
extensões `pg_cron` + `pg_net` + `pgcrypto`, e agenda os jobs (auto-mode,
scanner-pro, check-results, telegram-retry, ops-monitor, cache-cleanup).

## 5. Cadastrar secrets do backend
```bash
supabase secrets set \
  SPORTSRC_API_KEY=xxx \
  FOOTBALL_DATA_ORG_KEY=xxx \
  TELEGRAM_BOT_TOKEN=xxx \
  TELEGRAM_CHAT_ID=xxx \
  LOVABLE_API_KEY=xxx \
  APP_PUBLIC_URL=https://<sua-url>
# Opcionais: GEMINI_API_KEY, GROQ_API_KEY, TELEGRAM_ADMIN_CHAT_ID
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são
injetados automaticamente pelo runtime — não precisa cadastrar.

## 6. Deploy das 25 Edge Functions
```bash
supabase functions deploy --no-verify-jwt
```
Ou uma a uma: `supabase functions deploy football-api`, etc.

## 7. Auth (opcional — se usar login por email/Google)
No dashboard do novo projeto: Authentication → Providers → habilitar Email e
Google (OAuth). Configurar redirect URLs para a URL pública do frontend.
Auth Settings → habilitar "Password HIBP Check". Não há SMTP customizado
nem templates customizados neste projeto — o default do Supabase basta.

## 8. Publicar o frontend
Qualquer estático serve — a saída é `dist/`:
- **Vercel/Netlify/Cloudflare Pages**: importar repo, build `bun run build`,
  publish `dist/`, definir env vars `VITE_*`.
- **S3+CloudFront/Nginx**: subir `dist/` como site estático.

## 9. Testes finais (checklist)
- [ ] `/` carrega a Home com jogos do dia
- [ ] Login funciona (se auth habilitado)
- [ ] `curl https://<ref>.supabase.co/functions/v1/healthcheck` retorna `ok`
- [ ] `curl -X POST .../functions/v1/telegram-test` envia mensagem no bot
- [ ] Após 10 min, `select count(*) from telegram_signals where created_at > now()-interval '15 min';` > 0
- [ ] `select * from cron.job;` lista os 6+ jobs agendados

## 10. (Opcional) Preservar dados históricos
No projeto ANTIGO: **Cloud → Advanced settings → Export data** para baixar
dump SQL. Restaurar no novo com `psql < dump.sql` **depois** do `db push`.

---

## Storage / Buckets
Este projeto **não usa** Supabase Storage. Nenhum bucket precisa ser criado.

## Realtime
Não usado pelo cliente. Nada a configurar.

## Serviços externos usados
| Serviço | Uso | Grátis? |
|---|---|---|
| SportsRC | Dados live/pré + stats | Sim (1000/dia) |
| Football-Data.org | Fallback ligas principais | Sim |
| TheSportsDB | Fallback público (sem chave) | Sim |
| ESPN público | Fallback live sem chave | Sim |
| Telegram Bot API | Envio de sinais | Sim |
| Lovable AI Gateway | Analistas IA (opcional) | Créditos |
