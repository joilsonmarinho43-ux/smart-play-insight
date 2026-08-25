# NEXUS 33 — Diagnóstico e recuperação (VPS self-hosted)

O comportamento correto de referência é o do ambiente Lovable. Este guia cobre
as diferenças reais entre os dois ambientes e como resolvê-las.

---

## 0. Comandos rápidos

```bash
cd /root/nexus33
bash deploy/update.sh    # git pull + functions + secrets + migrations + cron + frontend + verify
bash deploy/verify.sh    # só a verificação (não altera nada)
```

`verify.sh` checa, nesta ordem: containers, secrets dentro do
`supabase-edge-functions`, `healthcheck`, diagnóstico das fontes de dados,
jogos do dia e o estado dos cron jobs.

---

## 1. "No Lovable funciona, na VPS não"

### 1.1 Import de CORS inexistente no runtime self-hosted
`npm:@supabase/supabase-js@2/cors` só existe no runtime hospedado. Na VPS a
função quebra no boot (500) e o módulo aparece vazio.
**Correção aplicada:** todas as funções importam
`supabase/functions/_shared/cors.ts`.
**Regra permanente:** nunca reintroduzir aquele import.

### 1.2 Versão flutuante do cliente Supabase
`esm.sh/@supabase/supabase-js@2` resolve para versões diferentes em cada
ambiente/dia. Agora está fixado em `@2.49.1` em todas as funções.

### 1.3 Secrets não chegam ao edge-runtime
Preencher `deploy/.env` não basta: o container `functions` precisa do
`env_file`. Rode `bash deploy/fix-secrets.sh` (o `update.sh` já roda) e
confirme com:
```bash
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' supabase-edge-functions | grep -c SPORTSRC_API_KEY
```

### 1.4 Bundle antigo no navegador (PWA)
`update.sh` recria o container do frontend e o `service-worker` invalida o
cache. Se persistir: botão **Atualizar app** na tela inicial, ou
`Ctrl+Shift+R`.

---

## 2. Jogos não aparecem (Elite / Placar Exato / Bet Analyzer / Bingo / Scanner)

Diagnóstico direto na função:
```bash
curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/football-api" \
  -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY" \
  -H 'Content-Type: application/json' -d '{"diag":true}'
```
Retorna `env` (chaves presentes) e `sources` (status/latência/quantidade por
fonte). Interpretação:

| Sintoma | Causa | Ação |
|---|---|---|
| `sportsrcKey: "missing"` | secret não injetado | `bash deploy/fix-secrets.sh` |
| `sportsrc status=429` | limite diário (1000/dia) estourado | aguardar reset; o cache de DB e o stale seguram o app |
| `sportsrc status=200 matches=0` | dia sem jogos no upstream | normal; ESPN cobre o restante |
| `espn status=403 error=unauthorized` | a ESPN bloqueia o IP do datacenter | a função tenta espelhos automaticamente; se todos falharem, a SportsRC assume |
| `espn error=blocked_payload` | espelho devolveu HTML em vez de JSON | idem acima, sem impacto se a SportsRC responder |
| tudo 200 mas o app vazio | cache antigo no navegador | botão **Atualizar jogos** nas telas |

Observações da auditoria:
- O filtro `status=live` da SportsRC é instável — a função busca hoje/ontem
  (UTC) e filtra o status localmente.
- Respostas vazias **não** são mais cacheadas (antes ficavam 6h presas em
  `cache_api` e bloqueavam a recuperação).
- As chaves de cache usam prefixo `v2_`, isolando qualquer resíduo antigo.

Limpar o cache do servidor manualmente:
```bash
docker exec supabase-db psql -U postgres -c "delete from public.cache_api where cache_key like 'v2_%';"
```

---

## 3. Sinais do Telegram pararam

```bash
docker exec supabase-db psql -U postgres -c "select jobname, schedule, active from cron.job order by jobname;"
bash deploy/fix-cron.sh          # reaponta os jobs para o domínio local e reativa
curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/telegram-test" -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY"
```
Sinais recentes:
```bash
docker exec supabase-db psql -U postgres -c "select count(*) from telegram_signals where created_at > now() - interval '2 hours';"
```

---

## 4. Cadastro / login falhando

```bash
grep -E 'ENABLE_EMAIL_SIGNUP|ENABLE_EMAIL_AUTOCONFIRM|DISABLE_SIGNUP' supabase-docker/.env
(cd supabase-docker && docker compose up -d --force-recreate auth)
```
Sem SMTP configurado, `ENABLE_EMAIL_AUTOCONFIRM=true` é obrigatório — caso
contrário o GoTrue falha ao enviar o e-mail e o cadastro quebra.

---

## 5. Logs

```bash
docker logs --tail 200 supabase-edge-functions
docker logs --tail 200 supabase-auth
docker logs --tail 200 supabase-db
```
As funções logam em formato estruturado, sem segredos:
`[fonte] label url=... status=... duration=...ms attempts=N`.
