// ═══════════════════════════════════════════════════════════════
// telegram-outbox-retry
// Cron worker: processa telegram_outbox (DLQ) com retry exponencial.
// Marca como 'delivered' ou 'dead' após max_attempts.
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTelegramMessage } from '../_shared/telegram.ts';


import { corsHeaders } from '../_shared/cors.ts';
const BATCH_SIZE = 25;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: rows, error } = await sb
      .from('telegram_outbox')
      .select('*')
      .eq('status', 'pending')
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let delivered = 0, deadCount = 0, retried = 0;

    for (const row of rows) {
      const result = await sendTelegramMessage(row.chat_id, row.text, {
        parseMode: (row.parse_mode as any) || 'HTML',
        tag: 'OUTBOX',
      });
      const newAttempts = (row.attempts || 0) + 1;

      if (result.ok) {
        await sb.from('telegram_outbox').update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          attempts: newAttempts,
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        delivered++;
      } else if (newAttempts >= (row.max_attempts || 3)) {
        await sb.from('telegram_outbox').update({
          status: 'dead',
          attempts: newAttempts,
          last_error: result.error || JSON.stringify(result.data || {}),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        deadCount++;
      } else {
        // backoff: 1m, 5m, 15m
        const backoffMin = [1, 5, 15][Math.min(newAttempts - 1, 2)];
        await sb.from('telegram_outbox').update({
          attempts: newAttempts,
          last_error: result.error || JSON.stringify(result.data || {}),
          next_retry_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        retried++;
      }
    }

    console.log(`[OUTBOX-RETRY] processed=${rows.length} delivered=${delivered} dead=${deadCount} retried=${retried}`);
    return new Response(JSON.stringify({ ok: true, processed: rows.length, delivered, dead: deadCount, retried }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[OUTBOX-RETRY] error:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
