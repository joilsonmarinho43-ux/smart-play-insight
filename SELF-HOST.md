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
git clone https://github.com/joilsonmarinho43-ux/smart-play-insight /opt/nexus33
cd /opt/nexus33

cp deploy/.env.example deploy/.env
nano deploy/.env        # preencha apenas APP_DOMAIN e API_DOMAIN

bash deploy/set-secrets.sh # chaves reais (fica em /etc/nexus33/secrets.env, fora do git)
bash deploy/preflight.sh   # verificação: DNS, RAM, disco, secrets, arquivos
bash deploy/install-vps.sh
```

### Onde ficam as chaves reais

As credenciais **nunca** vão para o repositório. `deploy/set-secrets.sh`
grava-as em `/etc/nexus33/secrets.env` (chmod 600, fora do git), e
`fix-secrets.sh` / `update.sh` / `preflight.sh` carregam esse cofre
automaticamente a cada deploy. `deploy/.env` guarda só domínios e valores
públicos e está no `.gitignore`.

Chaves pedidas: `SPORTSRC_API_KEY`, `FOOTBALL_DATA_ORG_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
(+ opcionais `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_API_KEY`, `LOVABLE_API_KEY`).
Se já estiverem no ambiente do shell: `bash deploy/set-secrets.sh --from-env`.

`preflight.sh` não altera nada — só valida a VPS, o `.env` e o cofre.


Na **primeira execução** o `install-vps.sh` gera as chaves do Supabase e
grava automaticamente `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`
em `deploy/.env` antes de buildar o frontend — não é preciso copiar nada à
mão. O script é idempotente e pode ser executado quantas vezes quiser.


O que o script faz:
1. Instala Docker (se faltar).
2. Baixa o compose oficial do Supabase em `supabase-docker/`.
3. Gera `JWT_SECRET`, senha do Postgres, `ANON_KEY` e `SERVICE_ROLE_KEY`.
4. Aplica as **41 migrations** (schema, RLS, GRANTs, funções, pg_cron),
   trocando automaticamente a URL antiga e a anon key dentro dos jobs de cron.
5. Sincroniza as **26 edge functions** via `deploy/sync-functions.sh`, que
   preserva/cria o router `main` exigido pelo Edge Runtime self-hosted, e
   injeta os secrets.
6. Builda o frontend e sobe o Caddy com HTTPS automático.

### Scripts do kit

| Script | Para quê |
|---|---|
| `deploy/preflight.sh` | Checagem pré-instalação: arquivos, domínios, **todas as chaves**, DNS, RAM/disco (não altera nada) |
| `deploy/install-vps.sh` | Instalação completa (idempotente) |
| `deploy/fix-secrets.sh` | Injeta **todos** os secrets no edge-runtime e reinicia as functions |
| `deploy/fix-cron.sh` | Reaponta os cron jobs para o `API_DOMAIN` e a ANON_KEY locais |
| `deploy/sync-functions.sh` | Reenvia só as edge functions |
| `deploy/apply-migrations.sh` | Aplica migrations pendentes (ledger `public.selfhost_migrations`) |
| `deploy/import-users.sh` | Importa e-mails/perfis de um CSV para `auth.users` (senha temporária) |
| `deploy/update.sh` | `git pull` + funções + secrets + migrations + cron + rebuild |
| `deploy/backup.sh` | Dump diário do Postgres (14 dias de retenção) |

### Fluxo de atualização (o único que você precisa)

```bash
cd /opt/nexus33
git pull
bash deploy/preflight.sh
bash deploy/fix-secrets.sh
bash deploy/update.sh      # opcional: só se quiser rebuildar o frontend
```

`fix-secrets.sh` deriva sozinho `APP_PUBLIC_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`,
espelha `TELEGRAM_API_KEY`/`TELEGRAM_BOT_TOKEN` e
`TELEGRAM_ADMIN_CHAT_ID`/`TELEGRAM_CHAT_ID`, e imprime ✓/✗ de cada chave
dentro do container. Chaves obrigatórias para o app rodar igual ao ambiente
gerenciado: `SPORTSRC_API_KEY`, `FOOTBALL_DATA_ORG_KEY`, `GEMINI_API_KEY`,
`GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.


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

### Sem dump do `auth.users` (só a lista de e-mails)

```bash
bash deploy/import-users.sh deploy/profiles.csv 'SenhaTemp@2026'
```

O CSV é enviado pelo STDIN do `psql` (não precisa existir dentro do
container), todos os campos de token do GoTrue são gravados como `''`
(evita `converting NULL to string is unsupported`) e importações antigas com
campos NULL são reparadas automaticamente. Cada usuário entra com a senha
temporária informada e deve trocá-la depois.


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
