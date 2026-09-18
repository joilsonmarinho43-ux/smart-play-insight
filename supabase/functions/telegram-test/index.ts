import { requireInternalServiceCall, requireAdminUser } from '../_shared/internalAuth.ts';
// ═══════════════════════════════════════════════════════════════
// telegram-test — envia mensagem de validação para TELEGRAM_CHAT_ID
// Admin-only (verify_jwt = true por padrão; chamada pelo painel admin)
// ═══════════════════════════════════════════════════════════════
import { sendTelegramMessage, escapeHtml, enqueueTelegramOutbox } from '../_shared/telegram.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return new Response(JSON.stringify({ ok: false, error: 'SERVER_CONFIG_MISSING' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const sb = createClient(supabaseUrl, supabaseKey);
  const admin = await requireAdminUser(req, sb, corsHeaders);
  if (admin) return admin;
  try {
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID not configured');

    const body = await req.json().catch(() => ({}));
    const text = `✅ <b>TESTE OK</b>\n${escapeHtml(body?.message || 'Healthcheck do bot')}\n<i>${new Date().toISOString()}</i>`;

    const r = await sendTelegramMessage(chatId, text, { tag: 'TG-TEST' });

    if (!r.ok) {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await enqueueTelegramOutbox(sb, {
        chat_id: chatId, text, source: 'telegram-test',
        last_error: r.error || JSON.stringify(r.data || {}),
      });
    }

    return new Response(JSON.stringify({ ok: r.ok, status: r.status, data: r.data }), {
      status: r.ok ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
