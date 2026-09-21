import { corsHeaders } from './cors.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export function requireInternalServiceCall(req: Request, headers: Record<string, string>): Response | null {
  const configuredServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
  const apiKey = req.headers.get('apikey')?.trim() || '';
  const ok = !!configuredServiceKey && (authorization === configuredServiceKey || apiKey === configuredServiceKey);
  if (ok) return null;
  return new Response(JSON.stringify({ ok: false, error: 'INTERNAL_CALL_REQUIRED' }), {
    status: 401,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export async function requireAdminUser(req: Request, sb: SupabaseClient, headers: Record<string, string>): Promise<Response | null> {
  const authorization = req.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return new Response(JSON.stringify({ ok: false, error: 'AUTH_REQUIRED' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return new Response(JSON.stringify({ ok: false, error: 'AUTH_REQUIRED' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
  const { data: profile, error: profileError } = await sb.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (profileError || profile?.is_admin !== true) return new Response(JSON.stringify({ ok: false, error: 'ADMIN_REQUIRED' }), { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } });
  return null;
}
