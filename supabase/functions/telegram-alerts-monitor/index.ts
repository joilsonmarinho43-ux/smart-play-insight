// ═══════════════════════════════════════════════════════════════
// telegram-alerts-monitor — cron 2min
// Dispara alerta para TELEGRAM_ADMIN_CHAT_ID quando:
//  • > 5 falhas (outbox pending+attempts ou status=dead) nos últimos 5 min
//  • Circuit breaker OPEN
//  • API quota > 90%
// Usa alert_should_fire para deduplicação (cooldown 10 min).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTelegramMessage, escapeHtml } from '../_shared/telegram.ts';
import { corsHeaders } from '../_shared/cors.ts';

const FAILURE_THRESHOLD = 5;
const QUOTA_PCT = 0.9;
const QUOTA_LIMIT = 7000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // ⚠️ Alertas operacionais SOMENTE para admin (nunca para o grupo de sinais).
    // Exige TELEGRAM_ADMIN_CHAT_ID explicitamente; se não houver, apenas loga.
    const adminChat = Deno.env.get('TELEGRAM_ADMIN_CHAT_ID');
    const groupChat = Deno.env.get('TELEGRAM_CHAT_ID');
    const canSendToAdmin = !!adminChat && adminChat !== groupChat;

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const alerts: { key: string; text: string }[] = [];

    // 1) Outbox failures
    const { count: failCount } = await sb
      .from('telegram_outbox')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', since)
      .in('status', ['dead', 'pending'])
      .gt('attempts', 0);

    if ((failCount || 0) > FAILURE_THRESHOLD) {
      alerts.push({
        key: 'outbox_failures',
        text: `⚠️ <b>ALERTA</b>\n${failCount} falhas no Telegram nos últimos 5 min (outbox).`,
      });
      console.error(`[TELEGRAM_FAILED] outbox_failures=${failCount}`);
    }

    // 2) Circuit breaker OPEN
    const { data: cb } = await sb
      .from('api_circuit_state')
      .select('service,state,last_error')
      .eq('state', 'OPEN');
    if (cb && cb.length > 0) {
      const services = cb.map((r: any) => `${r.service}: ${r.last_error || ''}`).join('\n');
      alerts.push({
        key: 'circuit_open',
        text: `🔴 <b>CIRCUIT_OPEN</b>\n${escapeHtml(services)}`,
      });
      console.error(`[CIRCUIT_OPEN] ${services}`);
    }

    // 3) API quota high — APENAS LOG (não envia ao Telegram para não poluir o grupo)
    const today = new Date().toISOString().slice(0, 10);
    const { data: quota } = await sb
      .from('api_usage_daily')
      .select('service,call_count')
      .eq('day', today);
    if (quota) {
      for (const q of quota as any[]) {
        if (q.call_count >= QUOTA_LIMIT * QUOTA_PCT) {
          console.warn(`[API_QUOTA_HIGH] ${q.service}=${q.call_count}/${QUOTA_LIMIT}`);
        }
      }
    }

    let fired = 0;
    if (canSendToAdmin) {
      for (const a of alerts) {
        const { data: should } = await sb.rpc('alert_should_fire', { _alert_key: a.key, _cooldown_minutes: 10 });
        if (should === true) {
          await sendTelegramMessage(adminChat!, a.text, { tag: 'TG-ALERT' });
          fired++;
        }
      }
    } else {
      for (const a of alerts) console.warn(`[TG-ALERT-SUPPRESSED] ${a.key}: ${a.text.replace(/\n/g, ' | ')}`);
    }

    return new Response(JSON.stringify({ ok: true, detected: alerts.length, fired, sent_to_admin: canSendToAdmin }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[TELEGRAM_ALERTS] error:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
