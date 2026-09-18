import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTelegramMessage, escapeHtml, enqueueTelegramOutbox } from '../_shared/telegram.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { computeObservedMarketValue } from '../_shared/marketValue.ts';

/** Downstream-only Telegram publisher. It never decides or promotes a signal. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    // This publisher is service-to-service only. It writes the privileged
    // telegram_signals ledger and must never accept a browser/public caller.
    // Keep verify_jwt=false because self-hosted deployments may use the
    // service-role API key rather than a user JWT; authenticate the capability
    // explicitly against the server-only SUPABASE_SERVICE_ROLE_KEY.
    const configuredServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = req.headers.get('authorization')?.replace(/^Bearer\\s+/i, '').trim() || '';
    const apiKey = req.headers.get('apikey')?.trim() || '';
    const internalAuthorized = !!configuredServiceKey && (authorization === configuredServiceKey || apiKey === configuredServiceKey);
    if (!internalAuthorized) {
      return new Response(JSON.stringify({ success: false, disabled: true, reason: 'INTERNAL_CALL_REQUIRED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const decision = body?.decision ?? {};
    const match = body?.match ?? {};
    // Nexus Core is the sole authority for the selected market and its model
    // metadata. Top-level duplicates are accepted only as integrity checks;
    // they can never override decision.selectedMarket.
    const coreSelectedMarket = decision?.selectedMarket ?? null;
    const selectedMarketPresent = !!coreSelectedMarket && typeof coreSelectedMarket === 'object';
    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(body ?? {}, key);
    const numericMatches = (key: string, coreValue: unknown) => {
      if (!hasOwn(key)) return true;
      const payloadValue = Number(body?.[key]);
      const normalizedCore = Number(coreValue);
      return Number.isFinite(payloadValue) && Number.isFinite(normalizedCore) && payloadValue === normalizedCore;
    };
    const stringMatches = (key: string, coreValue: unknown) => {
      if (!hasOwn(key)) return true;
      return String(body?.[key]) === String(coreValue ?? '');
    };
    const nestedSelectedMarketMatches = !hasOwn('selectedMarket') ||
      JSON.stringify(body?.selectedMarket ?? null) === JSON.stringify(coreSelectedMarket);
    const market = String(coreSelectedMarket?.market || '');
    const probability = Number(coreSelectedMarket?.probability);
    const confidence = Number(decision?.confidence ?? body?.confidence);
    const odd = Number(coreSelectedMarket?.odd);
    const probabilitySource = String(coreSelectedMarket?.probabilitySource ?? 'UNKNOWN');
    const calibrationStatus = String(coreSelectedMarket?.calibrationStatus ?? 'UNCALIBRATED');
    const oddSource = String(coreSelectedMarket?.oddSource ?? 'UNKNOWN').toUpperCase();
    const aiStatus = String(body?.aiAudit?.status || 'CAUTION');
    const signalEligible = decision?.signalEligible === true && decision?.decision === 'SIGNAL';
    const modelProbabilityValid = Number.isFinite(probability) && probability >= 0 && probability <= 100;
    const observedOddValid = Number.isFinite(odd) && odd > 1;
    const modelValidated = calibrationStatus === 'CALIBRATED' || calibrationStatus === 'MODEL_VALIDATED';
    const marketValue = computeObservedMarketValue(probability, odd);
    const coreApproved = Array.isArray(decision?.reasonCodes) && decision.reasonCodes.includes('CORE_APPROVED_SIGNAL');
    const payloadMatchesCore = nestedSelectedMarketMatches &&
      numericMatches('probability', coreSelectedMarket?.probability) &&
      numericMatches('odd', coreSelectedMarket?.odd) &&
      stringMatches('market', coreSelectedMarket?.market) &&
      stringMatches('probabilitySource', coreSelectedMarket?.probabilitySource) &&
      stringMatches('calibrationStatus', coreSelectedMarket?.calibrationStatus) &&
      stringMatches('oddSource', coreSelectedMarket?.oddSource) &&
      (!hasOwn('confidence') || Number(body?.confidence) === Number(decision?.confidence ?? body?.confidence));
    const positiveObservedValue = !!marketValue && marketValue.expectedValue > 0;
    const coreGateOk = selectedMarketPresent && !!market && signalEligible && coreApproved && payloadMatchesCore &&
      probabilitySource === 'MODEL_ESTIMATE' && modelValidated && oddSource === 'OBSERVED' &&
      aiStatus !== 'BLOCK' && modelProbabilityValid && Number.isFinite(confidence) &&
      confidence >= 85 && observedOddValid && positiveObservedValue;
    if (!coreGateOk) {
      return new Response(JSON.stringify({
        success: false,
        disabled: true,
        reason: 'CORE_GATE_REJECTED',
        detail: {
          signalEligible,
          coreApproved,
          selectedMarketPresent,
          payloadMatchesCore,
          probabilitySource,
          calibrationStatus,
          oddSource,
          hasModelProbability: modelProbabilityValid,
          hasObservedOdd: observedOddValid,
          positiveObservedValue,
          aiStatus,
        },
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!coreGateOk) {
      return new Response(JSON.stringify({ success: false, disabled: true, reason: 'CORE_GATE_REJECTED', detail: { signalEligible, coreApproved, selectedMarketMatches, probabilitySource, calibrationStatus, oddSource, hasModelProbability: modelProbabilityValid, hasObservedOdd: observedOddValid, positiveObservedValue, aiStatus } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
    const { data: inserted, error: insertError } = await sb.from('telegram_signals').insert({ match_id: matchId, match_name: matchName, market, market_type: body?.marketType || null, league, minute: Number.isFinite(minute) ? minute : 0, confidence, model_probability: probability, implied_probability: impliedProbability, expected_value: expectedValue, odd, status: 'pendente', result: 'pendente', success: null, roi: 0, sensitivity: body?.sensitivity || null, reason: body?.reason || null, rma_verdict: body?.rmaVerdict || null, rma_score: Number.isFinite(Number(body?.rmaScore)) ? Number(body.rmaScore) : null, probability_source: probabilitySource, calibration_status: calibrationStatus, odd_source: oddSource, core_approved: coreApproved, core_reason_codes: Array.isArray(decision?.reasonCodes) ? decision.reasonCodes : [] }).select('id').single();
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