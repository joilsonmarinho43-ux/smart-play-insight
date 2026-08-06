#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — importa os usuários (e-mails) para o Supabase self-hosted
#
#   bash deploy/import-users.sh deploy/profiles.csv [SENHA_PADRAO]
#
# CSV esperado (cabeçalho obrigatório):
#   id,email,is_admin,subscription_expiry_date,created_at
#
# IMPORTANTE: as SENHAS antigas NÃO podem ser migradas (ficam apenas
# como hash dentro do provedor anterior). Cada usuário é criado aqui com
# uma senha padrão temporária e deve usar "Esqueci minha senha" ou
# receber a nova senha de você.
# =====================================================================
set -euo pipefail

CSV="${1:-deploy/profiles.csv}"
DEFAULT_PASS="${2:-Nexus33@2026}"

[ -f "$CSV" ] || { echo "CSV não encontrado: $CSV"; exit 1; }

echo "Importando usuários de $CSV (senha temporária: $DEFAULT_PASS)"

docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE _imp (
  id uuid,
  email text,
  is_admin boolean,
  subscription_expiry_date timestamptz,
  created_at timestamptz
);
\copy _imp FROM '$(readlink -f "$CSV")' WITH CSV HEADER

-- 1) auth.users
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
SELECT '00000000-0000-0000-0000-000000000000', i.id, 'authenticated', 'authenticated',
       lower(i.email), crypt('$DEFAULT_PASS', gen_salt('bf')),
       now(), COALESCE(i.created_at, now()), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
FROM _imp i
ON CONFLICT (id) DO NOTHING;

-- 2) identidade de e-mail (necessária para login por senha)
INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
FROM auth.users u
JOIN _imp i ON i.id = u.id
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities ai WHERE ai.user_id = u.id AND ai.provider = 'email'
);

-- 3) profiles (o trigger handle_new_user pode já ter criado; garantimos os campos)
INSERT INTO public.profiles (id, email, is_admin, subscription_expiry_date, created_at)
SELECT i.id, lower(i.email), COALESCE(i.is_admin,false), i.subscription_expiry_date,
       COALESCE(i.created_at, now())
FROM _imp i
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      is_admin = EXCLUDED.is_admin,
      subscription_expiry_date = EXCLUDED.subscription_expiry_date;

SELECT count(*) AS usuarios_no_auth FROM auth.users;
SELECT count(*) AS perfis FROM public.profiles;
SQL

echo "Importação concluída. Peça aos usuários que usem 'Esqueci minha senha' ou informe a senha temporária."
