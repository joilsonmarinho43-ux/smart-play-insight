import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegramMessage, enqueueTelegramOutbox, escapeHtml } from '../_shared/telegram.ts';

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

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || Deno.env.get('TELEGRAM_API_KEY');
    if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');
    const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');

    const payload: SignalPayload = await req.json();

    // Validação mínima de input (defesa contra payloads malformados)
    if (!payload?.market || typeof payload.market !== 'string' ||
        !payload?.match || typeof payload.match !== 'string' ||
        typeof payload.confidence !== 'number' ||
        typeof payload.minute !== 'number') {
      return jsonResp({ success: false, error: 'invalid payload (match, market, confidence, minute required)' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // ═══ ANTI-REPETIÇÃO GLOBAL: 1 sinal por jogo/dia (BRT) ═══
    // Cobre qualquer emissor (auto-mode, scanner-pro, sniper) e qualquer
    // variação de mercado/minuto — evita 2 sinais do mesmo jogo (ex.: 9' e 17').
    {
      const brtDay = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const dayStartIso = `${brtDay}T03:00:00.000Z`;
      const normName = (payload.match || '').trim().toLowerCase();

      const { data: sameDay } = await sb
        .from('telegram_signals')
        .select('match_id, match_name, minute, market')
        .gte('created_at', dayStartIso)
        .eq('success', true)
        .limit(500);

      const already = (sameDay || []).some((r: any) =>
        (payload.matchId && r.match_id === payload.matchId) ||
        (normName && String(r.match_name || '').trim().toLowerCase() === normName)
      );

      if (already) {
        console.log(`[TELEGRAM-SIGNAL] ⏭️ Repetido no dia bloqueado: ${payload.match} • ${payload.market} • ${payload.minute}'`);
        return jsonResp({ success: true, deduped: true, reason: 'already_signaled_today' });
      }
    }

    // ═══ IDEMPOTÊNCIA ATÔMICA ═══
    let claimedSignalId: string | null = null;

    if (payload.matchId) {
      const { data: claimed, error: claimErr } = await sb.rpc('try_claim_telegram_slot', {
        _match_id: payload.matchId,
        _match_name: payload.match,
        _market: payload.market,
        _minute: payload.minute,
        _confidence: payload.confidence,
        _filters_validated: payload.filtersValidated ?? null,
        _sensitivity: payload.sensitivity ?? null,
        _score: payload.score ?? null,
        _poisson: payload.poisson ?? null,
        _odd_min: payload.oddMin ?? null,
        _janela: payload.janela ?? null,
        _reason: payload.reason ?? null,
      });

      if (claimErr) {
        console.error('[TELEGRAM-SIGNAL] try_claim_telegram_slot error:', claimErr);
        // fail-open: continua para tentar enviar (legado)
      } else if (!claimed) {
        console.log(`[TELEGRAM-SIGNAL] ⏭️ Duplicado bloqueado: ${payload.match} • ${payload.market} • ${payload.minute}'`);
        return jsonResp({ success: true, deduped: true });
      } else {
        claimedSignalId = claimed as unknown as string;
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
        if (claimedSignalId) {
          try {
            await sb.rpc('mark_telegram_signal_failed', {
              _signal_id: claimedSignalId,
              _error: `RMA_BLOCKED score=${rma.score}`,
            });
          } catch (e) { console.error('Failed to release slot after RMA block:', e); }
        }
        return jsonResp({ success: false, blocked: true, rma_verdict: 'BLOQUEADO', rma_score: rma.score });
      }
    }

    const emoji = payload.confidence >= 80 ? '🔥' : payload.confidence >= 70 ? '⚡' : '📊';
    const bars = Math.max(0, Math.min(5, Math.round(payload.confidence / 20)));
    const confBar = '🟢'.repeat(bars) + '⚪'.repeat(5 - bars);

    // 🧠 Leitura IA (Groq → Gemini fallback) — best-effort, nunca bloqueia o sinal
    let aiReading: string | null = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const aiRes = await fetch(`${supabaseUrl}/functions/v1/ai-signal-analyst`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        signal: ctrl.signal,
        body: JSON.stringify({
          mode: 'telegram',
          match: payload.match,
          minute: payload.minute,
          score: payload.score,
          market: payload.market,
          confidence: payload.confidence,
          reason: payload.reason,
          pressure: payload.pressure !== undefined ? { home: payload.pressure, away: 0 } : undefined,
          dangerousAttacks: payload.dangerousAttacks !== undefined ? { home: payload.dangerousAttacks, away: 0 } : undefined,
          shotsOnGoal: payload.shotsOnGoal !== undefined ? { home: payload.shotsOnGoal, away: 0 } : undefined,
        }),
      });
      clearTimeout(t);
      if (aiRes.ok) {
        const j = await aiRes.json();
        if (j?.ok && j?.text) aiReading = String(j.text).slice(0, 260);
      }
    } catch (e) {
      console.warn('[TELEGRAM-SIGNAL] AI reading skipped:', e instanceof Error ? e.message : e);
    }

    // 🔒 HTML escape em todos os campos dinâmicos — evita erro 400 do Telegram
    const text = [
      `${emoji} <b>${escapeHtml(payload.market)}</b>`,
      ``,
      `⚽ ${escapeHtml(payload.match)} • ${payload.minute}'`,
      `📊 ${escapeHtml(payload.score)}`,
      ``,
      `${confBar} <b>${payload.confidence}%</b>`,
      payload.janela ? `🕐 ${escapeHtml(payload.janela)}` : null,
      aiReading ? `` : null,
      aiReading ? `🧠 <i>${escapeHtml(aiReading)}</i>` : null,
      ``,
      `🤖 <i>Nexus 33</i>`,
    ].filter(Boolean).join('\n');


    // Envio via helper compartilhado (timeout, retry exponencial, detecção de erro permanente)
    const result = await sendTelegramMessage(CHAT_ID, text, {
      botToken: TELEGRAM_BOT_TOKEN,
      tag: 'TELEGRAM-SIGNAL',
    });

    const telegramSuccess = result.ok;
    const telegramMessageId: number | null = result.data?.result?.message_id ?? null;
    const telegramError = telegramSuccess
      ? ''
      : (result.error || `Telegram API [${result.status}]: ${JSON.stringify(result.data || {})}`);

    try {
      if (claimedSignalId) {
        if (telegramSuccess) {
          await sb.rpc('mark_telegram_signal_sent', {
            _signal_id: claimedSignalId,
            _message_id: telegramMessageId,
          });
        } else {
          await sb.rpc('mark_telegram_signal_failed', {
            _signal_id: claimedSignalId,
            _error: telegramError.slice(0, 500),
          });
        }
      } else {
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
          error_message: telegramError ? telegramError.slice(0, 500) : null,
          telegram_message_id: telegramMessageId,
          status: 'pendente',
        });
      }
    } catch (logErr) {
      console.error('[TELEGRAM-SIGNAL] Failed to log signal:', logErr);
    }

    if (telegramSuccess) {
      return jsonResp({ success: true, messageId: telegramMessageId });
    }

    // Falha após retries: enfileira para DLQ e retorna 200 (cliente já fez seu trabalho).
    // Retornar 500 aqui poderia induzir o cliente a reinvocar, gerando ruído.
    await enqueueTelegramOutbox(sb, {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      source: 'telegram-signal',
      signal_id: claimedSignalId,
      last_error: telegramError.slice(0, 500),
    });
    console.log('[TELEGRAM-SIGNAL] 📬 Enfileirado em telegram_outbox para retry assíncrono');

    return jsonResp({ success: false, queued: true, error: telegramError });
  } catch (error: unknown) {
    console.error('[TELEGRAM-SIGNAL] error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResp({ success: false, error: msg }, 500);
  }
});
