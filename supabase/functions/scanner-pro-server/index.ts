import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

// ═══════════════════════════════════════
// MATH HELPERS (Poisson)
// ═══════════════════════════════════════

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonProb(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function poissonOver(lambda: number, k: number): number {
  let cum = 0;
  for (let i = 0; i < k; i++) cum += poissonProb(lambda, i);
  return Math.max(0, Math.min(1, 1 - cum));
}

// ═══════════════════════════════════════
// RMA ENGINE (inline for edge function)
// ═══════════════════════════════════════
function evaluateRMAServer(minute: number, pressure: number, da: number, shots: number, sot: number): { verdict: 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO'; score: number; blockReason: string | null } {
  const safeMin = Math.max(minute, 1);
  const ap_norm = (da / safeMin) * 10;
  const f_norm = (shots / safeMin) * 10;
  const sot_norm = (sot / safeMin) * 10;

  let rma_score = (pressure * 0.4) + (ap_norm * 0.35) + (f_norm * 0.15) + (sot_norm * 0.10);

  if (pressure > 60 && da === 0 && sot === 0) return { verdict: 'BLOQUEADO', score: rma_score, blockReason: 'Pressão fake: pressão alta sem atividade' };

  const verdict = rma_score > 15 ? 'CONFIRMADO' as const : rma_score >= 8 ? 'NEUTRO' as const : 'BLOQUEADO' as const;
  return { verdict, score: Math.round(rma_score * 100) / 100, blockReason: verdict === 'BLOQUEADO' ? `Score ${Math.round(rma_score)} < 8` : null };
}

function safeDangerousAttacks(stats: any): number {
  if (stats.dangerousAttacks && stats.dangerousAttacks > 0) return stats.dangerousAttacks;
  return ((stats.totalShots || stats.shotsOnGoal || 0) * 1.5) + ((stats.corners || 0) * 2);
}

function calculatePressure(h: any, a: any): number {
  const hDA = safeDangerousAttacks(h || {});
  const aDA = safeDangerousAttacks(a || {});
  const corners = (h?.corners || 0) + (a?.corners || 0);
  const sog = (h?.shotsOnGoal || 0) + (a?.shotsOnGoal || 0);
  return Math.min(100, Math.max(0, (hDA + aDA) * 3 + corners * 5 + sog * 10) / 5);
}

// ═══════════════════════════════════════
// Confidence cap
// ═══════════════════════════════════════
function capConfidence(rawProb: number, minute: number, totalGoals: number): number {
  let conf = Math.min(rawProb, 95);
  if (minute < 25) {
    conf = conf - (25 - minute) / 25 * 15;
  }
  if (totalGoals === 0 && minute < 30) {
    conf = conf - 8;
  }
  return Math.max(50, Math.round(conf));
}

// ═══════════════════════════════════════
// EV + Odd estimation
// ═══════════════════════════════════════
function estimateOddAndEV(probability: number, market: string): { odd: number; ev: number } {
  if (probability <= 0) return { odd: 1, ev: -1 };
  const p = probability / 100;

  const margins: Record<string, number> = {
    'Over 0.5 HT': 0.90,
    'Over 0.5 Gols': 0.92,
    'Over 1.5 Gols': 0.90,
    'Over 2.5 Gols': 0.87,
    'Ambas Marcam': 0.88,
  };
  const margin = margins[market] || 0.88;
  const marketOdd = 1 / (p * margin);

  const minOdds: Record<string, number> = {
    'Over 0.5 HT': 1.10,
    'Over 0.5 Gols': 1.05,
    'Over 1.5 Gols': 1.20,
    'Over 2.5 Gols': 1.50,
    'Ambas Marcam': 1.40,
  };
  const minOdd = minOdds[market] || 1.20;
  const finalOdd = Math.max(marketOdd, minOdd);
  const ev = Math.round((p * finalOdd - 1) * 100) / 100;
  return { odd: Math.round(finalOdd * 100) / 100, ev };
}

function oppScore(prob: number, ev: number, pressure: number): number {
  const normP = prob / 100;
  const normEV = Math.max(0, Math.min(1, (ev + 0.1) / 0.2));
  const normPr = pressure / 100;
  return normP * 0.5 + normEV * 0.3 + normPr * 0.2;
}

// ═══════════════════════════════════════
// SNIPER SIGNAL INTERFACE
// ═══════════════════════════════════════
interface SniperSignal {
  matchId: string;
  match: string;
  league: string;
  minute: number;
  market: string;          // 'Over 1.5 Gols' or 'Over 0.5 HT'
  probability: number;
  ev: number;
  odd: number;
  pressure: number;
  score: number;           // opportunity score
  homeGoals: number;
  awayGoals: number;
  rmaVerdict?: 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO';
  rmaScore?: number;
  dangerousAttacks: number;
  totalShots: number;
  shotsOnGoal: number;
  ritmo: string;
  leitura: string;
  stake: number;
}

// ═══════════════════════════════════════
// SNIPER DUAL MODE SCANNER
// ═══════════════════════════════════════
function sniperScan(match: any): SniperSignal | null {
  const lH = match.stats?.home || {};
  const lA = match.stats?.away || {};
  const minute = match.fixture?.status?.elapsed || 0;
  if (minute <= 0) return null;

  const homeGoals = match.goals?.home ?? 0;
  const awayGoals = match.goals?.away ?? 0;
  const totalGoals = homeGoals + awayGoals;
  const homeTeam = match.teams?.home?.name || 'Casa';
  const awayTeam = match.teams?.away?.name || 'Fora';
  const league = match.league || '';
  const matchId = String(match.id || match.fixture?.id);

  const pressure = calculatePressure(lH, lA);
  const totalDA = safeDangerousAttacks(lH) + safeDangerousAttacks(lA);
  const totalShots = (lH.totalShots || 0) + (lA.totalShots || 0);
  const totalSoG = (lH.shotsOnGoal || 0) + (lA.shotsOnGoal || 0);

  // ─── Lambdas
  const hSoG = lH.shotsOnGoal || 0;
  const aSoG = lA.shotsOnGoal || 0;
  const adjustedMin = Math.max(minute, 10);
  const homeLambda = Math.max(0.3, (homeGoals + hSoG * 0.22) * (90 / adjustedMin));
  const awayLambda = Math.max(0.3, (awayGoals + aSoG * 0.22) * (90 / adjustedMin));
  const totalLambda = homeLambda + awayLambda;

  // ─── Ritmo classification
  const activityPerMin = (totalDA + totalShots + totalSoG) / Math.max(minute, 1);
  const ritmo = activityPerMin > 3 ? 'Acelerado 🔥' : activityPerMin > 1.5 ? 'Moderado ⚡' : 'Lento 🐌';

  // ─── RMA
  const rma = evaluateRMAServer(minute, pressure, totalDA, totalShots, totalSoG);

  const baseInfo = {
    matchId,
    match: `${homeTeam} vs ${awayTeam}`,
    league,
    minute,
    homeGoals,
    awayGoals,
    pressure: Math.round(pressure),
    dangerousAttacks: Math.round(totalDA),
    totalShots,
    shotsOnGoal: totalSoG,
    ritmo,
    rmaVerdict: rma.verdict,
    rmaScore: rma.score,
  };

  let htSignal: SniperSignal | null = null;
  let ftSignal: SniperSignal | null = null;

  // ═══════════════════════════════════════
  // OVER 0.5 HT — PRIORIDADE 2
  // ═══════════════════════════════════════
  const isFirstHalf = minute <= 45;
  if (isFirstHalf && totalGoals === 0 && minute >= 10 && minute <= 30) {
    // Only in first half, 0-0, minute 10-30
    const remainingHT = Math.max(1, 45 - minute);
    const htLambda = totalLambda * (remainingHT / 90);
    const rawProbHT = Math.round(poissonOver(htLambda, 1) * 100);
    const probHT = capConfidence(rawProbHT, minute, totalGoals);

    const { odd: oddHT, ev: evHT } = estimateOddAndEV(probHT, 'Over 0.5 HT');

    // HT rules — muito exigentes
    const htValid =
      probHT >= 82 &&
      pressure >= 55 &&       // pressão MUITO alta
      totalDA >= 8 &&         // ataques perigosos consistentes
      ritmo !== 'Lento 🐌' &&  // jogo não pode ser lento
      oddHT >= 1.30 &&
      evHT > 0 &&
      rma.verdict !== 'BLOQUEADO';

    if (htValid) {
      const score = oppScore(probHT, evHT, pressure);
      htSignal = {
        ...baseInfo,
        market: 'Over 0.5 HT',
        probability: probHT,
        ev: evHT,
        odd: oddHT,
        score: Math.round(score * 100) / 100,
        leitura: `1º tempo sem gols, pressão ofensiva de ${Math.round(pressure)}% com ${Math.round(totalDA)} ataques perigosos em ${minute} min. Ritmo ${ritmo.replace(/[🔥⚡🐌]/g, '').trim()}.`,
        stake: 3,
      };
    }
  }

  // ═══════════════════════════════════════
  // OVER 1.5 FT — PRIORIDADE 1
  // ═══════════════════════════════════════
  if (totalGoals < 2) {
    const remainingNeeded = 2 - totalGoals;
    const remainingMin = Math.max(1, 90 - minute);
    const remainingLambda = totalLambda * (remainingMin / 90);
    const rawProbFT = Math.round(poissonOver(remainingLambda, remainingNeeded) * 100);
    const probFT = capConfidence(rawProbFT, minute, totalGoals);

    const { odd: oddFT, ev: evFT } = estimateOddAndEV(probFT, 'Over 1.5 Gols');

    // FT rules — padrão alto
    const ftValid =
      probFT >= 80 &&
      pressure >= 40 &&
      totalDA >= 5 &&
      totalLambda >= 2.0 &&
      oddFT >= 1.25 && oddFT <= 1.60 &&
      evFT > 0 &&
      rma.verdict !== 'BLOQUEADO';

    if (ftValid) {
      const score = oppScore(probFT, evFT, pressure);
      ftSignal = {
        ...baseInfo,
        market: 'Over 1.5 Gols',
        probability: probFT,
        ev: evFT,
        odd: oddFT,
        score: Math.round(score * 100) / 100,
        leitura: `Tendência de gols λ=${totalLambda.toFixed(1)}, pressão ${Math.round(pressure)}% com ${Math.round(totalDA)} ataques perigosos. Placar ${homeGoals}-${awayGoals}.`,
        stake: totalGoals >= 1 ? 3 : 2,
      };
    }
  }

  // ═══════════════════════════════════════
  // PRIORIDADE: HT timing perfeito (10-25 + pressão alta) → HT, senão → FT
  // ═══════════════════════════════════════
  if (htSignal && ftSignal) {
    if (minute >= 10 && minute <= 25 && pressure >= 55) {
      console.log(`[SNIPER] ⚡ HT priorizado sobre FT: ${baseInfo.match} min ${minute}`);
      return htSignal;
    }
    console.log(`[SNIPER] 🎯 FT priorizado: ${baseInfo.match} min ${minute}`);
    return ftSignal;
  }

  return htSignal || ftSignal || null;
}

// ═══════════════════════════════════════
// SNIPER TELEGRAM MESSAGE FORMAT
// ═══════════════════════════════════════
function buildSniperMessage(s: SniperSignal): string {
  const rmaIcon = s.rmaVerdict === 'CONFIRMADO' ? '🟢' : '🟡';
  return [
    `🚨 <b>SINAL APROVADO — MODO SNIPER</b> ${rmaIcon}`,
    ``,
    `🏆 <b>${s.match}</b>`,
    `⏱️ Minuto: ${s.minute}'`,
    ``,
    `🎯 Mercado: <b>${s.market}</b>`,
    `📊 Confiança: <b>${s.probability}%</b>`,
    `💰 Odd: <b>${s.odd}</b>`,
    ``,
    `🧠 <i>${s.leitura}</i>`,
    ``,
    `🔥 <b>Contexto:</b>`,
    `  • Pressão: ${s.pressure}%`,
    `  • Ataques perigosos: ${s.dangerousAttacks}`,
    `  • Ritmo: ${s.ritmo}`,
    ``,
    `✅ Status: <b>ENTRADA APROVADA</b>`,
    `📌 Stake: ${s.stake}% da banca`,
    ``,
    `🤖 <i>Analista Joilson | Sniper Dual Mode</i>`,
  ].join('\n');
}

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey) {
      throw new Error('Variáveis de ambiente não configuradas');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch live matches
    const footballRes = await fetch(`${supabaseUrl}/functions/v1/football-api`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ live: true }),
    });
    const footballData = await footballRes.json();
    const matches = footballData?.matches || [];
    console.log(`[SNIPER-DUAL] ${matches.length} jogos ao vivo`);

    if (matches.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0, message: 'Nenhum jogo ao vivo' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Scan all matches with sniper mode
    const sniperSignals: SniperSignal[] = [];
    for (const match of matches) {
      const signal = sniperScan(match);
      if (signal) sniperSignals.push(signal);
    }

    // Sort by score
    sniperSignals.sort((a, b) => b.score - a.score);

    console.log(`[SNIPER-DUAL] ${sniperSignals.length} sinais qualificados`);

    if (sniperSignals.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0, analyzed: matches.length, message: 'Nenhum sinal sniper qualificado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Check duplicates today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: existingSignals } = await supabase
      .from('telegram_signals')
      .select('match_id, market')
      .gte('created_at', todayStart.toISOString())
      .eq('success', true);

    const signaledKeys = new Set((existingSignals || []).map((s: any) => `${s.match_id}-${s.market}`));
    const newSignals = sniperSignals.filter(s => !signaledKeys.has(`${s.matchId}-${s.market}`));

    // RMA gate — block BLOQUEADO
    const blocked = newSignals.filter(s => s.rmaVerdict === 'BLOQUEADO');
    const approved = newSignals.filter(s => s.rmaVerdict !== 'BLOQUEADO');

    // Log blocked
    for (const s of blocked) {
      console.log(`[SNIPER-DUAL] 🔴 BLOQUEADO: ${s.match} • ${s.market} (RMA ${s.rmaScore})`);
      await supabase.from('rma_shadow_logs').insert({
        match_id: s.matchId, match_name: s.match, market: s.market,
        minute: s.minute, original_signal: `${s.market} ${s.probability}%`,
        rma_verdict: 'BLOQUEADO', rma_score: s.rmaScore || 0, pressure: s.pressure,
        block_reason: 'Sniper Dual — bloqueado pelo RMA',
      });
    }

    if (approved.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0, analyzed: matches.length, blocked: blocked.length, message: 'Todos sinais bloqueados pelo RMA' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Send each approved signal as individual sniper message
    let sentCount = 0;
    for (const signal of approved) {
      const text = buildSniperMessage(signal);

      const tgRes = await fetch(`${GATEWAY_URL}/sendMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': TELEGRAM_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      const tgData = await tgRes.json();
      const telegramMessageId = tgData.result?.message_id ?? null;

      // Log to DB
      await supabase.from('telegram_signals').insert({
        match_name: signal.match,
        match_id: signal.matchId,
        market: signal.market,
        confidence: signal.probability,
        filters_validated: `Sniper Dual • Score ${signal.score}`,
        sensitivity: 'sniper-dual',
        minute: signal.minute,
        score: `${signal.homeGoals}-${signal.awayGoals}`,
        odd_min: String(signal.odd),
        reason: `Sniper Dual Mode • EV ${signal.ev > 0 ? '+' : ''}${signal.ev} • Odd ${signal.odd} • Pressão ${signal.pressure}% • ${signal.ritmo} • RMA ${signal.rmaVerdict}`,
        success: tgRes.ok,
        error_message: tgRes.ok ? null : JSON.stringify(tgData),
        telegram_message_id: telegramMessageId,
        status: 'pendente',
        rma_verdict: signal.rmaVerdict || null,
        rma_score: signal.rmaScore || null,
      });

      if (signal.rmaVerdict) {
        await supabase.from('rma_shadow_logs').insert({
          match_id: signal.matchId, match_name: signal.match, market: signal.market,
          minute: signal.minute, original_signal: `${signal.market} ${signal.probability}%`,
          rma_verdict: signal.rmaVerdict, rma_score: signal.rmaScore || 0, pressure: signal.pressure,
        });
      }

      if (tgRes.ok) sentCount++;
    }

    console.log(`[SNIPER-DUAL] ✅ ${sentCount} enviados, ${blocked.length} bloqueados`);

    return new Response(
      JSON.stringify({ success: true, signals: sentCount, analyzed: matches.length, blocked: blocked.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[SNIPER-DUAL] Erro:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
