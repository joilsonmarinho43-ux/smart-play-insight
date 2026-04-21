import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

// ═══════════════════════════════════════
// RMA ENGINE (inline)
// ═══════════════════════════════════════
function evaluateRMAServer(minute: number, pressure: number, da: number, shots: number, sot: number): { verdict: 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO'; score: number } {
  const safeMin = Math.max(minute, 1);
  const ap_norm = (da / safeMin) * 10;
  const f_norm = (shots / safeMin) * 10;
  const sot_norm = (sot / safeMin) * 10;
  let rma_score = (pressure * 0.4) + (ap_norm * 0.35) + (f_norm * 0.15) + (sot_norm * 0.10);
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
  // RMA stats (optional — if provided, RMA validates)
  pressure?: number;
  dangerousAttacks?: number;
  totalShots?: number;
  shotsOnGoal?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    if (!TELEGRAM_API_KEY) throw new Error('TELEGRAM_API_KEY not configured');

    const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');

    const payload: SignalPayload = await req.json();

    // ═══ RMA GATE ═══
    // If live stats are provided, validate through RMA
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

        // Log to shadow table
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const sb = createClient(supabaseUrl, supabaseKey);
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
        } catch (e) {
          console.error('Failed to log RMA block:', e);
        }

        return new Response(JSON.stringify({ success: false, blocked: true, rma_verdict: 'BLOQUEADO', rma_score: rma.score }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Build message
    const emoji = payload.confidence >= 80 ? '🔥' : payload.confidence >= 70 ? '⚡' : '📊';
    const sensitivityEmoji = { conservador: '🛡️', moderado: '⚖️', agressivo: '🔥' }[payload.sensitivity] || '⚖️';

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

    try {
      const response = await fetch(`${GATEWAY_URL}/sendMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': TELEGRAM_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        telegramError = `Telegram API failed [${response.status}]: ${JSON.stringify(data)}`;
      } else {
        telegramSuccess = true;
        telegramMessageId = data.result?.message_id ?? null;
      }
    } catch (e) {
      telegramError = e instanceof Error ? e.message : 'Unknown Telegram error';
    }

    // Log signal to database
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, supabaseKey);

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

    if (!telegramSuccess) {
      throw new Error(telegramError);
    }

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
