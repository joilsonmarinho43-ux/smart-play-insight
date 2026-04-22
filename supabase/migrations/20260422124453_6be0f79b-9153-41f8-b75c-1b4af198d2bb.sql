
-- Fix active_sessions UPDATE: prevent changing user_id
DROP POLICY IF EXISTS "Users can update own session" ON public.active_sessions;
CREATE POLICY "Users can update own session"
ON public.active_sessions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Fix hybrid_entries UPDATE: prevent changing user_id
DROP POLICY IF EXISTS "Users update own hybrid entries" ON public.hybrid_entries;
CREATE POLICY "Users update own hybrid entries"
ON public.hybrid_entries
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
