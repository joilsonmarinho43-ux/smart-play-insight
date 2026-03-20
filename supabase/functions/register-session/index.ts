import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_token, device_info } = await req.json();

    // Use service role to bypass RLS
    const admin = createClient(supabaseUrl, serviceRoleKey);

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
