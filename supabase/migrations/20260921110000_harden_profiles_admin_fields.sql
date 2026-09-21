-- NEXUS 33 — prevent authenticated users from self-escalating profile privileges.
-- The legacy self-update policy allowed a user to modify is_admin and
-- subscription_expiry_date because PostgreSQL RLS policies cannot restrict
-- individual columns. Profile updates are now admin-only.
--
-- The application currently reads profiles client-side but does not require
-- an authenticated user's own UPDATE permission for normal operation.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Reassert the privileged path explicitly.
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

CREATE POLICY "Admins can update all profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

REVOKE UPDATE ON public.profiles FROM anon;
GRANT UPDATE ON public.profiles TO authenticated;
