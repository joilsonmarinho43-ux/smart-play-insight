
-- Table to track the active session per user (only 1 allowed)
CREATE TABLE public.active_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  session_token text NOT NULL,
  device_info text,
  ip_address text,
  logged_in_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read their own session
CREATE POLICY "Users can read own session"
ON public.active_sessions FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Users can upsert their own session
CREATE POLICY "Users can upsert own session"
ON public.active_sessions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own session"
ON public.active_sessions FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

-- Admins can read all sessions
CREATE POLICY "Admins can read all sessions"
ON public.active_sessions FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

-- Table to log session conflicts (for admin notifications)
CREATE TABLE public.session_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  old_device_info text,
  new_device_info text,
  old_ip text,
  new_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen boolean NOT NULL DEFAULT false
);

ALTER TABLE public.session_conflicts ENABLE ROW LEVEL SECURITY;

-- Only admins can read conflicts
CREATE POLICY "Admins can read session conflicts"
ON public.session_conflicts FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

-- Only admins can update (mark as seen)
CREATE POLICY "Admins can update session conflicts"
ON public.session_conflicts FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()));

-- Authenticated users can insert conflicts (triggered by login logic)
CREATE POLICY "Users can insert conflicts"
ON public.session_conflicts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
