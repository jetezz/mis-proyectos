-- ============================================================
-- Usuario de prueba para OpenCode Agent
-- ============================================================
-- Ejecución: Supabase Dashboard → SQL Editor → pegar y ejecutar
--
-- Credenciales del usuario de prueba:
--   Email    : admin@opencode.local
--   Password : Admin1234!
--
-- Notas:
--   - Se usa crypt() de pgcrypto (disponible por defecto en Supabase)
--   - email_confirmed_at se establece ya como confirmado (sin email)
--   - provider_id = email (requerido en versiones recientes de Supabase)
-- ============================================================

DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
  user_email  text := 'admin@opencode.local';
  user_pass   text := 'Admin1234!';
BEGIN

  -- 1. Insertar en auth.users
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    user_email,
    crypt(user_pass, gen_salt('bf')),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"role": "admin"}',
    NOW(),
    NOW(),
    '', '', '', ''
  );

  -- 2. Insertar en auth.identities
  -- IMPORTANTE: provider_id es NOT NULL en versiones recientes de Supabase.
  -- Para el provider 'email', provider_id debe ser el email del usuario.
  INSERT INTO auth.identities (
    id,
    provider_id,        -- ← añadido: requerido en Supabase >= 2.x
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    user_email,          -- provider_id = email para provider 'email'
    new_user_id,
    jsonb_build_object(
      'sub',   new_user_id::text,
      'email', user_email
    ),
    'email',
    NOW(),
    NOW(),
    NOW()
  );

  RAISE NOTICE 'Usuario creado correctamente con ID: %', new_user_id;
  RAISE NOTICE 'Email: % | Password: %', user_email, user_pass;

END $$;

-- ============================================================
-- Verificar que se creó correctamente
-- ============================================================
SELECT
  u.id,
  u.email,
  u.email_confirmed_at,
  u.created_at,
  i.provider,
  i.provider_id
FROM auth.users u
JOIN auth.identities i ON i.user_id = u.id
WHERE u.email = 'admin@opencode.local';
