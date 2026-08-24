// ═══════════════════════════════════════════════════════════════
// telegram-retry — reenvio manual de mensagem da outbox
// POST { id: uuid } → reabre status=pending e envia imediatamente
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTelegramMessage } from '../_shared/telegram.ts';


import { corsHeaders } from '../_shared/cors.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const id = body?.id;
    if (!id || typeof id !== 'string') {
      return new Response(JSON.stringify({ ok: false, error: 'missing id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Reabre slot via RPC (atômico)
    const { data: rpc, error: rpcErr } = await sb.rpc('retry_telegram_outbox_message', { _id: id });
    if (rpcErr) throw rpcErr;
    if (!rpc?.ok) {
      console.log(`[TELEGRAM_RETRY] not_found | id=${id}`);
      return new Response(JSON.stringify({ ok: false, error: rpc?.error || 'not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pega payload e tenta envio imediato
    const { data: row, error: selErr } = await sb
      .from('telegram_outbox')
      .select('*')
      .eq('id', id)
      .single();
    if (selErr || !row) throw selErr || new Error('row missing after retry');

    const result = await sendTelegramMessage(row.chat_id, row.text, {
      parseMode: (row.parse_mode as any) || 'HTML',
      tag: 'TG-RETRY',
    });

    const newAttempts = (row.attempts || 0) + 1;
    if (result.ok) {
      await sb.from('telegram_outbox').update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        attempts: newAttempts,
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      console.log(`[TELEGRAM_RETRY] sent | id=${id} | attempts=${newAttempts}`);
      return new Response(JSON.stringify({ ok: true, id, attempts: newAttempts }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const errMsg = result.error || JSON.stringify(result.data || {});
    await sb.from('telegram_outbox').update({
      status: newAttempts >= (row.max_attempts || 3) ? 'dead' : 'pending',
      attempts: newAttempts,
      last_error: errMsg,
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    console.error(`[TELEGRAM_RETRY] failed | id=${id} | attempts=${newAttempts} | ${errMsg}`);

    return new Response(JSON.stringify({ ok: false, id, attempts: newAttempts, error: errMsg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[TELEGRAM_RETRY] error:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
