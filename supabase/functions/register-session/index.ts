import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use service role to validate the caller token and update the single active device session
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_token, device_info } = await req.json();
    if (!session_token || typeof session_token !== "string") {
      return new Response(JSON.stringify({ error: "Missing session token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ RATE LIMIT ═══
    // 5 chamadas por minuto por usuário. Atômico via advisory lock + UPSERT no DB.
    const { data: allowed, error: rlErr } = await admin.rpc('check_rate_limit', {
      _bucket: 'register-session',
      _subject: user.id,
      _max_calls: 5,
      _window_seconds: 60,
    });
    if (rlErr) {
      console.error('[register-session] rate_limit error:', rlErr);
      // fail-open: nunca bloquear usuário legítimo por falha de infra
    } else if (allowed === false) {
      return new Response(
        JSON.stringify({
          error: 'Too many session registrations. Tente novamente em 1 minuto.',
          code: 'RATE_LIMITED',
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': '60',
          },
        },
      );
    }

    // Check existing session
    const { data: existing } = await admin
      .from("active_sessions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // If there's an existing session with a different token, log conflict
    if (existing && existing.session_token !== session_token) {
      await admin.from("session_conflicts").insert({
        user_id: user.id,
        user_email: user.email,
        old_device_info: existing.device_info,
        new_device_info: device_info,
      });
    }

    // Upsert the active session
    if (existing) {
      await admin
        .from("active_sessions")
        .update({
          session_token,
          device_info,
          logged_in_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    } else {
      await admin.from("active_sessions").insert({
        user_id: user.id,
        session_token,
        device_info,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
