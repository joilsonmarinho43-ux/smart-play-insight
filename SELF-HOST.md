# NEXUS 33 — Self-hosting completo na sua VPS

Tudo roda na sua máquina: frontend, Postgres, Auth, PostgREST, Realtime,
Storage, Edge Functions e os cron jobs. Zero dependência de hospedagem de
terceiros (só as APIs externas de futebol/IA, que continuam sendo chaves suas).

---

## 1. Requisitos da VPS

| Item | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disco | 40 GB SSD | 80 GB SSD |
| SO | Ubuntu 22.04/24.04 | Ubuntu 24.04 |

Provedores baratos com boa latência para o Brasil: Hetzner (Ashburn),
Contabo, Vultr (São Paulo), Magalu Cloud, Hostinger VPS.

---

## 2. DNS

Crie dois registros **A** apontando para o IP da VPS:

```
analista.funecob.com.br   →  IP
api.funecob.com.br        →  IP
```

Se usar Cloudflare, deixe o proxy **desligado** (nuvem cinza) no primeiro
deploy, para o Let's Encrypt validar.

---

## 3. Instalação (um comando)

```bash
ssh root@SEU_IP
apt update && apt install -y git
git clone https://github.com/joilsonmarinho43-ux/nexus33 /opt/nexus33
cd /opt/nexus33

cp deploy/.env.example deploy/.env
nano deploy/.env        # preencha domínios e chaves das APIs

bash deploy/install-vps.sh
```

Na **primeira execução** o script gera as chaves do Supabase e imprime a
`ANON_KEY`. Cole-a em `VITE_SUPABASE_PUBLISHABLE_KEY` (em `deploy/.env`) e
rode o script de novo — ele é idempotente.

O que o script faz:
1. Instala Docker (se faltar).
2. Baixa o compose oficial do Supabase em `supabase-docker/`.
3. Gera `JWT_SECRET`, senha do Postgres, `ANON_KEY` e `SERVICE_ROLE_KEY`.
4. Aplica as **41 migrations** (schema, RLS, GRANTs, funções, pg_cron),
   trocando automaticamente a URL antiga e a anon key dentro dos jobs de cron.
5. Copia as **26 edge functions** para o Edge Runtime e injeta os secrets.
6. Builda o frontend e sobe o Caddy com HTTPS automático.

---

## 4. Depois de subir

```
App     https://analista.funecob.com.br
API     https://api.funecob.com.br
Studio  http://IP_DA_VPS:8000     (usuário: supabase, senha impressa no install)
```

Bloqueie a porta 8000 externa depois de configurar:

```bash
ufw allow 22,80,443/tcp && ufw enable
```

### Auth
No Studio → Authentication → URL Configuration:
- Site URL: `https://analista.funecob.com.br`
- Redirect URLs: a mesma + `/auth/callback`

Para login Google, cadastre o provider com o client ID/secret do Google Cloud
e redirect `https://api.funecob.com.br/auth/v1/callback`.

---

## 5. Operação do dia a dia

```bash
bash deploy/update.sh    # git pull + rebuild + migrations + restart functions
bash deploy/backup.sh    # dump comprimido em ./backups (mantém 14 dias)

docker compose -f deploy/docker-compose.yml logs -f app
cd supabase-docker && docker compose logs -f functions
```

Backup automático:
```bash
(crontab -l 2>/dev/null; echo "0 4 * * * /opt/nexus33/deploy/backup.sh >> /var/log/nexus33-backup.log 2>&1") | crontab -
```

---

## 6. Migrar os dados atuais

No backend atual: **Cloud → Advanced settings → Export data**. Depois:

```bash
gunzip -c dump.sql.gz | docker exec -i supabase-db psql -U postgres -d postgres
```

Faça isso **depois** das migrations. Usuários do `auth.users` vêm no mesmo
dump; as senhas continuam válidas porque o hash é bcrypt.

---

## 7. Diferenças do ambiente gerenciado

| Recurso | Gerenciado | Self-hosted |
|---|---|---|
| Deploy de edge function | automático | `deploy/update.sh` |
| Backups | automáticos | `deploy/backup.sh` (cron) |
| Escala/upgrade | painel | você redimensiona a VPS |
| Atualização do Supabase | automática | `cd supabase-docker && docker compose pull && docker compose up -d` |
| SSL | automático | Caddy (automático também) |

---

## 8. Checklist final

- [ ] `https://<APP_DOMAIN>` abre a Home com jogos
- [ ] `curl https://<API_DOMAIN>/functions/v1/healthcheck` → `ok`
- [ ] `curl -X POST https://<API_DOMAIN>/functions/v1/telegram-test` → mensagem no bot
- [ ] `docker exec supabase-db psql -U postgres -c "select * from cron.job;"` lista os jobs
- [ ] Login funciona
- [ ] Backup no cron
