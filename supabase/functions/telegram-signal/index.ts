import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ═══════════════════════════════════════
// RMA ENGINE (inline)
// ═══════════════════════════════════════
function evaluateRMAServer(minute: number, pressure: number, da: number, shots: number, sot: number): { verdict: 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO'; score: number } {
  const safeMin = Math.max(minute, 1);
  const ap_norm = (da / safeMin) * 10;
  const f_norm = (shots / safeMin) * 10;
  const sot_norm = (sot / safeMin) * 10;
  const rma_score = (pressure * 0.4) + (ap_norm * 0.35) + (f_norm * 0.15) + (sot_norm * 0.10);
  if (pressure > 60 && da === 0 && sot === 0) return { verdict: 'BLOQUEADO', score: rma_score };
  const verdict = rma_score > 15 ? 'CONFIRMADO' as const : rma_score >= 8 ? 'NEUTRO' as const : 'BLOQUEADO' as const;
  return { verdict, score: Math.round(rma_score * 100) / 100 };
}

interface SignalPayload {
  match: string;
  matchId?: string;
  market: string;
  confidence: number;
  filtersValidated: string;
  sensitivity: string;
  minute: number;
  score: string;
  poisson?: string;
  oddMin?: string;
  janela?: string;
  reason?: string;
  pressure?: number;
  dangerousAttacks?: number;
  totalShots?: number;
  shotsOnGoal?: number;
}

const MAX_ATTEMPTS = 4;
const RETRY_DELAYS = [500, 1500, 3500];

async function sendTelegramDirect(botToken: string, chatId: string, text: string): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.ok === true, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || Deno.env.get('TELEGRAM_API_KEY');
    if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');
    const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');

    const payload: SignalPayload = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // ═══ IDEMPOTÊNCIA ═══
    // Evita duplicar o MESMO sinal (match + market + minuto) em janela de 90s
    if (payload.matchId) {
      const since = new Date(Date.now() - 90_000).toISOString();
      const { data: dup } = await sb
        .from('telegram_signals')
        .select('id, telegram_message_id, success')
        .eq('match_id', payload.matchId)
        .eq('market', payload.market)
        .eq('minute', payload.minute)
        .eq('success', true)
        .gte('created_at', since)
        .maybeSingle();
      if (dup) {
        console.log(`[TELEGRAM-SIGNAL] ⏭️ Duplicado ignorado (idempotência): ${payload.match} • ${payload.market} • ${payload.minute}'`);
        return new Response(JSON.stringify({ success: true, deduped: true, messageId: dup.telegram_message_id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ═══ RMA GATE ═══
    if (payload.pressure !== undefined && payload.minute > 0) {
      const rma = evaluateRMAServer(
        payload.minute,
        payload.pressure || 0,
        payload.dangerousAttacks || 0,
        payload.totalShots || 0,
        payload.shotsOnGoal || 0,
      );
      if (rma.verdict === 'BLOQUEADO') {
        console.log(`[TELEGRAM-SIGNAL] 🔴 RMA BLOQUEOU: ${payload.match} • ${payload.market} (score: ${rma.score})`);
        try {
          await sb.from('rma_shadow_logs').insert({
            match_id: payload.matchId || 'unknown',
            match_name: payload.match,
            market: payload.market,
            minute: payload.minute,
            original_signal: `${payload.market} ${payload.confidence}%`,
            rma_verdict: 'BLOQUEADO',
            rma_score: rma.score,
            pressure: payload.pressure || null,
            block_reason: 'telegram-signal — sinal bloqueado pelo RMA',
          });
        } catch (e) { console.error('Failed to log RMA block:', e); }
        return new Response(JSON.stringify({ success: false, blocked: true, rma_verdict: 'BLOQUEADO', rma_score: rma.score }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const emoji = payload.confidence >= 80 ? '🔥' : payload.confidence >= 70 ? '⚡' : '📊';
    const confBar = '🟢'.repeat(Math.round(payload.confidence / 20)) + '⚪'.repeat(5 - Math.round(payload.confidence / 20));

    const text = [
      `${emoji} <b>${payload.market}</b>`,
      ``,
      `⚽ ${payload.match} • ${payload.minute}'`,
      `📊 ${payload.score}`,
      ``,
      `${confBar} <b>${payload.confidence}%</b>`,
      payload.janela ? `🕐 ${payload.janela}` : null,
      ``,
      `🤖 <i>Analista Joilson</i>`,
    ].filter(Boolean).join('\n');

    let telegramSuccess = false;
    let telegramError = '';
    let telegramMessageId: number | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { ok, status, data } = await sendTelegramDirect(TELEGRAM_BOT_TOKEN, CHAT_ID, text);
        if (ok) {
          telegramSuccess = true;
          telegramMessageId = data?.result?.message_id ?? null;
          telegramError = '';
          if (attempt > 1) console.log(`[TELEGRAM-SIGNAL] ✅ Sucesso na tentativa ${attempt}`);
          break;
        }
        telegramError = `Telegram API failed [${status}]: ${JSON.stringify(data)}`;

        // Respect 429 retry_after if provided
        let delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
        if (status === 429 && data?.parameters?.retry_after) {
          delay = Math.max(delay, Number(data.parameters.retry_after) * 1000);
        }
        const isTransient = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (!isTransient || attempt === MAX_ATTEMPTS) break;
        console.log(`[TELEGRAM-SIGNAL] ⚠️ tentativa ${attempt} falhou (${status}), retry em ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      } catch (e) {
        telegramError = e instanceof Error ? e.message : 'Unknown Telegram error';
        if (attempt === MAX_ATTEMPTS) break;
        const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
        console.log(`[TELEGRAM-SIGNAL] ⚠️ tentativa ${attempt} erro de rede, retry em ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    try {
      await sb.from('telegram_signals').insert({
        match_name: payload.match,
        match_id: payload.matchId || null,
        market: payload.market,
        confidence: payload.confidence,
        filters_validated: payload.filtersValidated,
        sensitivity: payload.sensitivity,
        minute: payload.minute,
        score: payload.score,
        poisson: payload.poisson || null,
        odd_min: payload.oddMin || null,
        janela: payload.janela || null,
        reason: payload.reason || null,
        success: telegramSuccess,
        error_message: telegramError || null,
        telegram_message_id: telegramMessageId,
        status: 'pendente',
      });
    } catch (logErr) {
      console.error('Failed to log signal:', logErr);
    }

    if (!telegramSuccess) throw new Error(telegramError);

    return new Response(JSON.stringify({ success: true, messageId: telegramMessageId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Telegram signal error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
