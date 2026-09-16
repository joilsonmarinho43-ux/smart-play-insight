import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTelegramMessage, escapeHtml, enqueueTelegramOutbox } from '../_shared/telegram.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { computeObservedMarketValue } from '../_shared/marketValue.ts';

/** Downstream-only Telegram publisher. It never decides or promotes a signal. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const decision = body?.decision ?? {};
    const market = String(body?.market || '');
    const match = body?.match ?? {};
    const selectedMarket = body?.selectedMarket ?? decision?.selectedMarket ?? {};
    const probability = Number(body?.probability ?? selectedMarket?.probability);
    const confidence = Number(body?.confidence);
    const odd = Number(body?.odd ?? selectedMarket?.odd);
    const probabilitySource = String(body?.probabilitySource ?? selectedMarket?.probabilitySource ?? 'UNKNOWN');
    const calibrationStatus = String(body?.calibrationStatus ?? selectedMarket?.calibrationStatus ?? 'UNCALIBRATED');
    const oddSource = String(body?.oddSource || 'UNKNOWN').toUpperCase();
    const aiStatus = String(body?.aiAudit?.status || 'CAUTION');
    const signalEligible = decision?.signalEligible === true && decision?.decision === 'SIGNAL';
    const modelProbabilityValid = Number.isFinite(probability) && probability >= 0 && probability <= 100;
    const observedOddValid = Number.isFinite(odd) && odd > 1;
    const modelValidated = calibrationStatus === 'CALIBRATED' || calibrationStatus === 'MODEL_VALIDATED';
    const marketValue = computeObservedMarketValue(probability, odd);
    const coreGateOk = !!market && signalEligible && probabilitySource === 'MODEL_ESTIMATE' && modelValidated && oddSource === 'OBSERVED' && aiStatus !== 'BLOCK' && modelProbabilityValid && Number.isFinite(confidence) && confidence >= 85 && observedOddValid && !!marketValue;
    if (!coreGateOk) {
      return new Response(JSON.stringify({ success: false, disabled: true, reason: 'CORE_GATE_REJECTED', detail: { signalEligible, probabilitySource, calibrationStatus, oddSource, hasModelProbability: modelProbabilityValid, hasObservedOdd: observedOddValid, aiStatus } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!chatId) return new Response(JSON.stringify({ success: false, disabled: true, reason: 'TELEGRAM_CHAT_ID_MISSING' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const matchId = String(match.id || '');
    const matchName = `${match.homeTeam || 'Casa'} x ${match.awayTeam || 'Fora'}`;
    const league = String(match.league || body?.league || 'Liga não informada');
    const minute = Number(match.minute ?? body?.minute ?? 0);
    const impliedProbability = marketValue!.impliedProbability;
    const expectedValue = marketValue!.expectedValue;
    const text = [
      '🎯 <b>NEXUS 33 — SINAL ANALÍTICO</b>', '', `⚔️ <b>${escapeHtml(matchName)}</b>`, `🏆 ${escapeHtml(league)}`, '',
      `📌 <b>Mercado:</b> ${escapeHtml(market)}`, `📊 <b>Probabilidade do modelo:</b> ${probability.toFixed(2)}%`, `💰 <b>Odd observada:</b> ${odd.toFixed(2)}`,
      `📐 <b>Prob. implícita:</b> ${impliedProbability.toFixed(2)}%`, `📈 <b>EV real:</b> ${(expectedValue * 100).toFixed(2)}%`, `🧠 <b>Confiança:</b> ${confidence.toFixed(0)}%`, '',
      `🔐 <b>Core:</b> ${escapeHtml((decision.reasonCodes || []).join(', ') || 'CORE_APPROVED_SIGNAL')}`, `🤖 <b>Auditoria IA:</b> ${escapeHtml(aiStatus)}`, '',
      `Nexus 33 • modelo ${escapeHtml(calibrationStatus === 'CALIBRATED' ? 'empiricamente calibrado' : 'estruturalmente validado')} + odd observada`,
    ].join('\n');
    const { data: existing } = await sb.from('telegram_signals').select('id,telegram_message_id,status').eq('match_id', matchId).eq('market', market).eq('status', 'pendente').maybeSingle();
    if (existing?.id) return new Response(JSON.stringify({ success: true, duplicate: true, signalId: existing.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: inserted, error: insertError } = await sb.from('telegram_signals').insert({ match_id: matchId, match_name: matchName, market, market_type: body?.marketType || null, league, minute: Number.isFinite(minute) ? minute : 0, confidence, model_probability: probability, implied_probability: impliedProbability, expected_value: expectedValue, odd, status: 'pendente', result: 'pendente', success: null, roi: 0, sensitivity: body?.sensitivity || null, reason: body?.reason || null, rma_verdict: body?.rmaVerdict || null, rma_score: Number.isFinite(Number(body?.rmaScore)) ? Number(body.rmaScore) : null }).select('id').single();
    if (insertError) return new Response(JSON.stringify({ success: false, reason: 'SIGNAL_LEDGER_INSERT_FAILED', detail: insertError.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const sent = await sendTelegramMessage(chatId, text, { tag: 'NEXUS-SIGNAL' });
    if (!sent.ok) {
      await enqueueTelegramOutbox(sb, { chat_id: chatId, text, parse_mode: 'HTML', source: 'nexus-core', signal_id: inserted?.id || null, last_error: sent.data?.description || sent.error || `status_${sent.status}` });
      return new Response(JSON.stringify({ success: false, queued: true, signalId: inserted?.id || null, reason: 'TELEGRAM_SEND_FAILED_OUTBOX' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    await sb.from('telegram_signals').update({ telegram_message_id: sent.data?.result?.message_id || null }).eq('id', inserted.id);
    return new Response(JSON.stringify({ success: true, signalId: inserted.id, telegramMessageId: sent.data?.result?.message_id || null, modelProbability: probability, impliedProbability, expectedValue }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ success: false, reason: e instanceof Error ? e.message : 'internal_error' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});