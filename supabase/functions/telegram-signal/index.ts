import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';
import { sendTelegramMessage, escapeHtml, enqueueTelegramOutbox } from '../_shared/telegram.ts';

/**
 * Telegram is a downstream publisher only.
 * It cannot calculate a signal, override Nexus Core, or create a prediction.
 * The caller must provide an already persisted prediction id and a Core-approved
 * calibrated model market with a real observed odd.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const decision = body?.decision ?? {};
    const market = String(body?.market || '');
    const predictionId = String(body?.predictionId || '');
    const probability = Number(body?.probability);
    const confidence = Number(body?.confidence);
    const odd = Number(body?.odd);
    const aiStatus = String(body?.aiAudit?.status || 'CAUTION');
    const signalEligible = decision?.signalEligible === true && decision?.decision === 'SIGNAL';
    const calibrated = body?.probabilitySource ? body.probabilitySource === 'MODEL_ESTIMATE' : true;

    if (!predictionId || !market || !signalEligible || !calibrated || aiStatus === 'BLOCK' || !Number.isFinite(probability) || probability < 0 || probability > 100 || !Number.isFinite(confidence) || confidence < 85 || !Number.isFinite(odd) || odd <= 1) {
      return new Response(JSON.stringify({ success: false, disabled: true, reason: 'CORE_GATE_REJECTED' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!chatId) return new Response(JSON.stringify({ success: false, disabled: true, reason: 'TELEGRAM_CHAT_ID_MISSING' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const match = body?.match ?? {};
    const matchName = `${match.homeTeam || 'Casa'} x ${match.awayTeam || 'Fora'}`;
    const text = [
      '🎯 <b>NEXUS 33 — SINAL PRÉ-JOGO</b>',
      '',
      `⚔️ <b>${escapeHtml(matchName)}</b>`,
      `🏆 ${escapeHtml(match.league || 'Liga não informada')}`,
      '',
      `📌 <b>Mercado:</b> ${escapeHtml(market)}`,
      `📊 <b>Probabilidade:</b> ${probability.toFixed(0)}%`,
      `💰 <b>Odd observada:</b> ${odd.toFixed(2)}`,
      `🧠 <b>Confiança:</b> ${confidence.toFixed(0)}%`,
      '',
      `🔐 <b>Core:</b> ${escapeHtml((decision.reasonCodes || []).join(', ') || 'CORE_APPROVED_SIGNAL')}`,
      `🤖 <b>Auditoria IA:</b> ${escapeHtml(aiStatus)}`,
      '',
      'Nexus 33 • sinal analítico baseado em modelo calibrado e odd observada',
    ].join('\n');

    const { data: existing } = await sb.from('telegram_signals').select('id,telegram_message_id,status').eq('prediction_id', predictionId).maybeSingle();
    if (existing?.id) return new Response(JSON.stringify({ success: true, duplicate: true, signalId: existing.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: inserted, error: insertError } = await sb.from('telegram_signals').insert({
      match_id: String(match.id), match_name: matchName, market, market_type: body?.marketType || null,
      probability, confidence, odd, status: 'pendente', result: 'pendente', success: null, roi: 0,
      prediction_id: predictionId,
    }).select('id').single();
    if (insertError) return new Response(JSON.stringify({ success: false, reason: 'SIGNAL_LEDGER_INSERT_FAILED', detail: insertError.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const sent = await sendTelegramMessage(chatId, text, { tag: 'NEXUS-SIGNAL' });
    if (!sent.ok) {
      await enqueueTelegramOutbox(sb, { chat_id: chatId, text, parse_mode: 'HTML', source: 'nexus-core', signal_id: inserted?.id || null, last_error: sent.data?.description || sent.error || `status_${sent.status}` });
      return new Response(JSON.stringify({ success: false, queued: true, signalId: inserted?.id || null, reason: 'TELEGRAM_SEND_FAILED_OUTBOX' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await sb.from('telegram_signals').update({ telegram_message_id: sent.data?.result?.message_id || null }).eq('id', inserted.id);
    return new Response(JSON.stringify({ success: true, signalId: inserted.id, telegramMessageId: sent.data?.result?.message_id || null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, reason: e instanceof Error ? e.message : 'internal_error' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
