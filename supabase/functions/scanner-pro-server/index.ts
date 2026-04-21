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
// SCANNER ENGINE (server-side)
// ═══════════════════════════════════════

interface ScannerOpp {
  matchId: string;
  match: string;
  league: string;
  minute: number;
  market: string;
  probability: number;
  ev: number;
  pressure: number;
  score: number;
  signal: string | null;
  homeGoals: number;
  awayGoals: number;
  rmaVerdict?: 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO';
  rmaScore?: number;
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

  if (ap_norm < 1.5) return { verdict: 'BLOQUEADO', score: rma_score, blockReason: 'AP_norm < 1.5' };
  if (pressure > 60 && da === 0) return { verdict: 'BLOQUEADO', score: rma_score, blockReason: 'Pressão fake' };
  if (sot_norm === 0) return { verdict: 'NEUTRO', score: rma_score, blockReason: 'SOT_norm = 0' };

  const verdict = rma_score > 65 ? 'CONFIRMADO' as const : rma_score >= 50 ? 'NEUTRO' as const : 'BLOQUEADO' as const;
  return { verdict, score: Math.round(rma_score * 100) / 100, blockReason: null };
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
// Confidence cap — nunca 100%, penalidade por tempo baixo
// ═══════════════════════════════════════
function capConfidence(rawProb: number, minute: number, totalGoals: number): number {
  // Hard cap at 95%
  let conf = Math.min(rawProb, 95);

  // Penalidade por jogo cedo (< 25 min): -15% proporcional
  if (minute < 25) {
    const earlyPenalty = (25 - minute) / 25 * 15;
    conf = conf - earlyPenalty;
  }

  // Penalidade se 0-0 e minuto < 30
  if (totalGoals === 0 && minute < 30) {
    conf = conf - 8;
  }

  return Math.max(50, Math.round(conf));
}

// ═══════════════════════════════════════
// EV real — baseado em odd de mercado estimada via Poisson
// ═══════════════════════════════════════
function estimateEV(probability: number, market: string, minute: number): number {
  if (probability <= 0) return -1;
  const p = probability / 100;

  // Margem da casa varia por mercado
  const margins: Record<string, number> = {
    'Over 0.5 Gols': 0.92,
    'Over 1.5 Gols': 0.90,
    'Over 2.5 Gols': 0.87,
    'Ambas Marcam': 0.88,
  };
  const margin = margins[market] || 0.88;

  // Odd estimada do mercado (com margem da casa)
  const marketOdd = 1 / (p * margin);

  // Odd mínima realista por mercado
  const minOdds: Record<string, number> = {
    'Over 0.5 Gols': 1.05,
    'Over 1.5 Gols': 1.20,
    'Over 2.5 Gols': 1.50,
    'Ambas Marcam': 1.40,
  };
  const minOdd = minOdds[market] || 1.20;
  const finalOdd = Math.max(marketOdd, minOdd);

  // EV = (prob * odd) - 1
  const ev = p * finalOdd - 1;
  return Math.round(ev * 100) / 100;
}

function oppScore(prob: number, ev: number, pressure: number): number {
  const normP = prob / 100;
  const normEV = Math.max(0, Math.min(1, (ev + 0.1) / 0.2));
  const normPr = pressure / 100;
  return normP * 0.5 + normEV * 0.3 + normPr * 0.2;
}

function scanMatch(match: any): ScannerOpp[] {
  const lH = match.stats?.home || {};
  const lA = match.stats?.away || {};
  const minute = match.fixture?.status?.elapsed || 0;
  const homeGoals = match.goals?.home ?? 0;
  const awayGoals = match.goals?.away ?? 0;
  const homeTeam = match.teams?.home?.name || 'Casa';
  const awayTeam = match.teams?.away?.name || 'Fora';
  const league = match.league || '';
  const matchId = String(match.id || match.fixture?.id);

  // Need some stats
  const totalSoG = (lH.shotsOnGoal || 0) + (lA.shotsOnGoal || 0);
  const totalDA = safeDangerousAttacks(lH) + safeDangerousAttacks(lA);
  if (totalSoG < 1 && totalDA < 3) return [];

  const pressure = calculatePressure(lH, lA);

  // Estimate lambdas from live stats (xG proxy)
  const hSoG = lH.shotsOnGoal || 0;
  const aSoG = lA.shotsOnGoal || 0;
  const adjustedMin = Math.max(minute, 10);
  const homeLambda = Math.max(0.3, (homeGoals + hSoG * 0.22) * (90 / adjustedMin));
  const awayLambda = Math.max(0.3, (awayGoals + aSoG * 0.22) * (90 / adjustedMin));
  const totalLambda = homeLambda + awayLambda;

  const results: ScannerOpp[] = [];
  const totalGoals = homeGoals + awayGoals;

  // Markets to evaluate
  const markets = [
    { name: 'Over 0.5 Gols', k: 1, adjust: totalGoals },
    { name: 'Over 1.5 Gols', k: 2, adjust: totalGoals },
    { name: 'Over 2.5 Gols', k: 3, adjust: totalGoals },
  ];

  for (const m of markets) {
    // If already over this threshold, skip
    if (totalGoals >= m.k) continue;

    const remainingNeeded = m.k - totalGoals;
    const remainingMin = Math.max(1, 90 - minute);
    const remainingLambda = totalLambda * (remainingMin / 90);
    const rawProb = Math.round(poissonOver(remainingLambda, remainingNeeded) * 100);

    // Apply confidence cap
    const prob = capConfidence(rawProb, minute, totalGoals);

    if (prob < 60) continue;
    const ev = estimateEV(prob, m.name, minute);
    if (ev <= 0) continue;

    const score = oppScore(prob, ev, pressure);
    const isGoalImminent = pressure > 70 && totalSoG >= 4 && minute >= 20;

    results.push({
      matchId,
      match: `${homeTeam} vs ${awayTeam}`,
      league,
      minute,
      market: m.name,
      probability: prob,
      ev,
      pressure: Math.round(pressure),
      score: Math.round(score * 100) / 100,
      signal: isGoalImminent ? '🔥 GOL IMINENTE' : null,
      homeGoals,
      awayGoals,
    });
  }

  // BTTS
  if (homeGoals === 0 || awayGoals === 0) {
    const bttsProbH = 1 - poissonProb(homeLambda, 0);
    const bttsProbA = 1 - poissonProb(awayLambda, 0);
    let rawBtts = Math.round(bttsProbH * bttsProbA * 100);
    if (homeGoals > 0) rawBtts = Math.round(bttsProbA * 100);
    if (awayGoals > 0) rawBtts = Math.round(bttsProbH * 100);

    const bttsProb = capConfidence(rawBtts, minute, totalGoals);

    if (bttsProb >= 60) {
      const ev = estimateEV(bttsProb, 'Ambas Marcam', minute);
      if (ev > 0) {
        results.push({
          matchId, match: `${homeTeam} vs ${awayTeam}`, league, minute,
          market: 'Ambas Marcam', probability: bttsProb, ev,
          pressure: Math.round(pressure), score: oppScore(bttsProb, ev, pressure),
          signal: null, homeGoals, awayGoals,
        });
      }
    }
  }

  // ═══ RMA VALIDATION ═══
  if (minute > 0) {
    const totalDA_raw = (lH.dangerousAttacks || 0) + (lA.dangerousAttacks || 0);
    const totalShots = (lH.totalShots || 0) + (lA.totalShots || 0);
    const rma = evaluateRMAServer(minute, pressure, totalDA_raw, totalShots, totalSoG);
    for (const r of results) {
      r.rmaVerdict = rma.verdict;
      r.rmaScore = rma.score;
    }
  }

  return results;
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
    console.log(`[SCANNER-PRO-SERVER] ${matches.length} jogos ao vivo`);

    if (matches.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0, message: 'Nenhum jogo ao vivo' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Scan all matches
    let allOpps: ScannerOpp[] = [];
    for (const match of matches) {
      const opps = scanMatch(match);
      allOpps.push(...opps);
    }

    // Sort by score, deduplicate, top 5
    allOpps.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const topOpps: ScannerOpp[] = [];
    for (const opp of allOpps) {
      const key = `${opp.matchId}-${opp.market}`;
      if (seen.has(key)) continue;
      seen.add(key);
      topOpps.push(opp);
      if (topOpps.length >= 5) break;
    }

    console.log(`[SCANNER-PRO-SERVER] ${allOpps.length} total opps, top ${topOpps.length}`);

    if (topOpps.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0, analyzed: matches.length, message: 'Nenhuma oportunidade qualificada' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Check for duplicates (avoid spamming same match+market today)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: existingSignals } = await supabase
      .from('telegram_signals')
      .select('match_id, market')
      .gte('created_at', todayStart.toISOString())
      .eq('success', true);

    const signaledKeys = new Set((existingSignals || []).map((s: any) => `${s.match_id}-${s.market}`));
    const newOpps = topOpps.filter(o => !signaledKeys.has(`${o.matchId}-${o.market}`));

    if (newOpps.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0, analyzed: matches.length, message: 'Todas oportunidades já sinalizadas hoje' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Build and send consolidated Telegram message
    const oppLines = newOpps.map((o, i) => {
      const priorityEmoji = o.score > 0.75 ? '🔥' : o.score >= 0.65 ? '⚡' : '📊';
      const confBar = '🟢'.repeat(Math.round(o.probability / 20)) + '⚪'.repeat(5 - Math.round(o.probability / 20));
      const rmaIcon = o.rmaVerdict === 'CONFIRMADO' ? '🟢' : o.rmaVerdict === 'BLOQUEADO' ? '🔴' : '🟡';
      return [
        `${priorityEmoji} <b>${o.market}</b> ${rmaIcon}`,
        `⚽ ${o.match} • ${o.minute}'`,
        `📊 ${o.homeGoals}-${o.awayGoals} ${confBar} <b>${o.probability}%</b>`,
        o.signal ? `${o.signal}` : null,
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    const text = [
      `🎯 <b>SCANNER PRO</b> • ${newOpps.length} sinais`,
      ``,
      oppLines,
      ``,
      `🤖 <i>Analista Joilson</i>`,
    ].join('\n');

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

    // 5. Log each opportunity to DB
    for (const opp of newOpps) {
      await supabase.from('telegram_signals').insert({
        match_name: opp.match,
        match_id: opp.matchId,
        market: opp.market,
        confidence: opp.probability,
        filters_validated: `Score ${opp.score}`,
        sensitivity: 'scanner-pro',
        minute: opp.minute,
        score: `${opp.homeGoals}-${opp.awayGoals}`,
        reason: `Scanner PRO Server • EV ${opp.ev > 0 ? '+' : ''}${opp.ev} • Pressão ${opp.pressure}`,
        success: tgRes.ok,
        error_message: tgRes.ok ? null : JSON.stringify(tgData),
        telegram_message_id: telegramMessageId,
        status: 'pendente',
      });
    }

    console.log(`[SCANNER-PRO-SERVER] ${tgRes.ok ? '✅' : '❌'} ${newOpps.length} oportunidades enviadas`);

    return new Response(
      JSON.stringify({ success: true, signals: newOpps.length, analyzed: matches.length, total_opps: allOpps.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[SCANNER-PRO-SERVER] Erro:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
