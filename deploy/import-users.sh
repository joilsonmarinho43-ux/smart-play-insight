#!/usr/bin/env bash
# =====================================================================
# NEXUS 33 — importa os usuários (e-mails) para o Supabase self-hosted
#
#   bash deploy/import-users.sh deploy/profiles.csv [SENHA_PADRAO]
#
# CSV esperado (cabeçalho obrigatório):
#   id,email,is_admin,subscription_expiry_date,created_at
#
# IMPORTANTE:
#  - As SENHAS antigas NÃO podem ser migradas. Cada usuário é criado com
#    uma senha temporária e deve trocá-la depois.
#  - O GoTrue atual (Go) faz Scan de colunas de token como string NOT NULL
#    lógico: se ficarem NULL o login falha com
#    'converting NULL to string is unsupported'.
#    Por isso todos os campos de token são gravados como '' (string vazia)
#    e o script também REPARA usuários já importados anteriormente.
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

-- 1) auth.users (todos os campos de token preenchidos com '')
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, invited_at,
  confirmation_token, confirmation_sent_at,
  recovery_token, recovery_sent_at,
  email_change_token_new, email_change, email_change_sent_at,
  email_change_token_current, email_change_confirm_status,
  last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
  reauthentication_token, reauthentication_sent_at,
  is_sso_user, banned_until, deleted_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  i.id, 'authenticated', 'authenticated',
  lower(i.email), crypt('$DEFAULT_PASS', gen_salt('bf')),
  now(), NULL,
  '', NULL,
  '', NULL,
  '', '', NULL,
  '', 0,
  NULL,
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  false, COALESCE(i.created_at, now()), now(),
  NULL, NULL, '', '', NULL,
  '', NULL,
  false, NULL, NULL
FROM _imp i
ON CONFLICT (id) DO NOTHING;

-- 1b) REPARO: usuários importados antes com campos NULL
UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change               = COALESCE(email_change, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change_confirm_status= COALESCE(email_change_confirm_status, 0),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, ''),
  is_sso_user                = COALESCE(is_sso_user, false),
  is_super_admin             = COALESCE(is_super_admin, false),
  aud                        = COALESCE(NULLIF(aud, ''), 'authenticated'),
  role                       = COALESCE(NULLIF(role, ''), 'authenticated'),
  email_confirmed_at         = COALESCE(email_confirmed_at, now()),
  raw_app_meta_data          = COALESCE(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
  raw_user_meta_data         = COALESCE(raw_user_meta_data, '{}'::jsonb),
  updated_at                 = now()
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR email_change_token_current IS NULL
   OR email_change_confirm_status IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL
   OR is_sso_user IS NULL
   OR is_super_admin IS NULL
   OR aud IS NULL OR role IS NULL
   OR email_confirmed_at IS NULL
   OR raw_app_meta_data IS NULL
   OR raw_user_meta_data IS NULL;

-- 2) identidade de e-mail (necessária para login por senha)
INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
FROM auth.users u
JOIN _imp i ON i.id = u.id
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities ai WHERE ai.user_id = u.id AND ai.provider = 'email'
);

-- 3) profiles
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
SELECT count(*) AS tokens_nulos FROM auth.users
 WHERE confirmation_token IS NULL OR recovery_token IS NULL
    OR email_change_token_new IS NULL OR email_change_token_current IS NULL
    OR reauthentication_token IS NULL;
SQL

echo "Importação/reparo concluídos. Se 'tokens_nulos' = 0, o login por senha deve funcionar."
