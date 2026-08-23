import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { dynamicConfidence, isDynamicConfidenceEnabled } from '../_shared/dynamicConfidence.ts';
import { classifyConfidence, resolveMatchConfidence, logConfidenceDecision } from '../_shared/confidencePolicy.ts';
import { projectGoals } from '../_shared/goalProjection.ts';
import { evaluateRMA } from '../_shared/rmaEngine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
function safeDangerousAttacks(stats: any): number {
  if (stats.dangerousAttacks && stats.dangerousAttacks > 0) return stats.dangerousAttacks;
  return ((stats.totalShots || stats.shotsOnGoal || 0) * 1.5) + ((stats.corners || 0) * 2);
}

function hasRealDangerousAttacks(stats: any): boolean {
  return Number(stats?.dangerousAttacks || 0) > 0;
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
  const league = typeof match.league === 'string' ? match.league : (match.league?.name || '');
  const matchId = String(match.id || match.fixture?.id);

  const pressure = calculatePressure(lH, lA);
  const totalDA = safeDangerousAttacks(lH) + safeDangerousAttacks(lA);
  const daEstimated = !hasRealDangerousAttacks(lH) || !hasRealDangerousAttacks(lA);
  const totalShots = (lH.totalShots || 0) + (lA.totalShots || 0);
  const totalSoG = (lH.shotsOnGoal || 0) + (lA.shotsOnGoal || 0);
  const totalCorners = (lH.corners || 0) + (lA.corners || 0);

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
  const rma = evaluateRMA({
    minute, pressure, dangerousAttacks: totalDA, totalShots,
    shotsOnGoal: totalSoG, daEstimated,
  });

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
  if (isFirstHalf && totalGoals === 0 && minute >= 10 && minute <= 25) {
    // Only in first half, 0-0, minute 10-25 (hard filter)
    const remainingHT = Math.max(1, 45 - minute);
    const htLambda = totalLambda * (remainingHT / 90);
    const rawProbHT = Math.round(poissonOver(htLambda, 1) * 100);
    let probHT = capConfidence(rawProbHT, minute, totalGoals);

    if (isDynamicConfidenceEnabled()) {
      const dyn = dynamicConfidence(probHT, {
        minute, homeGoals, awayGoals,
        sotTotal: totalSoG, shotsTotal: totalShots, daTotal: totalDA,
        pressure, pressureRecent: pressure,
        requiredGoals: 1,
      });
      console.log(`[DYN-CONF HT] ${baseInfo.match} min ${minute}: ${probHT}% → ${dyn.confidence}% • ${dyn.reason}`);
      probHT = dyn.confidence;
    }

    const { odd: oddHT, ev: evHT } = estimateOddAndEV(probHT, 'Over 0.5 HT');

    // HT rules — muito exigentes
    const htValid =
      probHT >= 82 &&
      pressure >= 55 &&       // pressão MUITO alta
      totalDA >= 8 &&         // ataques perigosos consistentes
      ritmo !== 'Lento 🐌' &&  // jogo não pode ser lento
      (totalSoG >= 3 || (totalSoG >= 2 && totalCorners >= 2)) &&
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
  // 🔒 VALOR DE ODD: só entra em Over 1.5 com 0x0 e até o minuto 35.
  // Com gol já marcado (ou tarde demais) a odd cai para ~1.15-1.25 → entrada sem valor.
  if (totalGoals === 0 && minute <= 25) {
    const remainingNeeded = 2 - totalGoals;
    const remainingMin = Math.max(1, 90 - minute);
    const remainingLambda = totalLambda * (remainingMin / 90);
    const rawProbFT = Math.round(poissonOver(remainingLambda, remainingNeeded) * 100);
    let probFT = capConfidence(rawProbFT, minute, totalGoals);

    if (isDynamicConfidenceEnabled()) {
      const dyn = dynamicConfidence(probFT, {
        minute, homeGoals, awayGoals,
        sotTotal: totalSoG, shotsTotal: totalShots, daTotal: totalDA,
        pressure, pressureRecent: pressure,
        requiredGoals: 2,
      });
      console.log(`[DYN-CONF FT] ${baseInfo.match} min ${minute}: ${probFT}% → ${dyn.confidence}% • ${dyn.reason}`);
      probFT = dyn.confidence;
    }

    const { odd: oddFT, ev: evFT } = estimateOddAndEV(probFT, 'Over 1.5 Gols');

    // 🔒 GATE POISSON por eventos reais — 0x0 precisa de 2 gols
    const proj = projectGoals({ minute, sog: totalSoG, totalShots, da: totalDA, corners: totalCorners, pressure });
    if (proj.probAtLeast2 < 0.60) {
      console.log(`[SNIPER] 🔴 Poisson bloqueou FT: ${baseInfo.match} min ${minute} • P(≥2)=${(proj.probAtLeast2 * 100).toFixed(0)}% (λ=${proj.lambdaRemaining})`);
    }

    // FT rules — padrão alto
    const ftValid =
      proj.probAtLeast2 >= 0.60 &&
      probFT >= 80 &&
      pressure >= 50 &&
      totalSoG >= 3 &&
      totalDA >= 8 &&
      (!daEstimated || (totalSoG >= 4 && totalShots >= 7 && totalCorners >= 2)) &&
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
  // ROTEAMENTO DE MERCADO: mantém o volume, mas escolhe o mercado cuja
  // exigência combina melhor com o estado observado. HT pede explosão imediata;
  // FT pede sustentação suficiente para dois gols.
  // ═══════════════════════════════════════
  if (htSignal && ftSignal) {
    const htUrgency = htSignal.probability + Math.min(8, totalSoG * 2 + totalCorners);
    const ftStrength = ftSignal.probability + Math.min(8, totalShots / 2 + totalSoG);
    if (minute >= 14 && htUrgency >= ftStrength + 2) {
      console.log(`[SNIPER] ⚡ HT priorizado sobre FT: ${baseInfo.match} min ${minute}`);
      return htSignal;
    }
    console.log(`[SNIPER] 🎯 FT priorizado: ${baseInfo.match} min ${minute}`);
    return ftSignal;
  }

  return htSignal || ftSignal || null;
}

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey) {
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

    // 3. Check duplicates today (BRT)
    const brtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const todayStartIso = `${brtDay}T03:00:00.000Z`;
    console.log(`[TIMEZONE] scanner day_brt=${brtDay} startIso=${todayStartIso}`);
    const { data: existingSignals } = await supabase
      .from('telegram_signals')
      .select('match_id, match_name, market')
      .gte('created_at', todayStartIso)
      .eq('success', true);

    // 1 sinal por JOGO/dia (ignora mercado) — evita repetição entre funções
    const signaledMatchIds = new Set((existingSignals || []).map((s: any) => String(s.match_id || '')).filter(Boolean));
    const signaledNames = new Set((existingSignals || []).map((s: any) => String(s.match_name || '').trim().toLowerCase()).filter(Boolean));
    let newSignals = sniperSignals.filter(s =>
      !signaledMatchIds.has(String(s.matchId)) && !signaledNames.has(String(s.match || '').trim().toLowerCase())
    );


    // ─── CONFIDENCE POLICY GATE ────────────────────────────────────
    // Resolve confidence_score por jogo (paralelo) e aplica política:
    //   ≥85 normal | 70-84 conservador | 50-69 info_only (skip) | <50 discard
    const confidenceMap = new Map<string, { score: number; mode: string; source: string }>();
    const uniqueMatches = Array.from(new Map(newSignals.map(s => [s.matchId, s])).values());
    const confResults = await Promise.all(uniqueMatches.map(async (s) => {
      const [h, a] = s.match.split(' vs ');
      const r = await resolveMatchConfidence(supabaseUrl, supabaseKey, {
        matchId: s.matchId, homeTeam: h, awayTeam: a, league: s.league,
      });
      const policy = classifyConfidence(r.score);
      logConfidenceDecision('SNIPER-DUAL', s.match, r.score, policy.mode, r.source);
      return { matchId: s.matchId, score: r.score, mode: policy.mode, source: r.source };
    }));
    for (const c of confResults) confidenceMap.set(c.matchId, c);

    let confDiscarded = 0, confInfo = 0, confConservative = 0;
    newSignals = newSignals.filter(s => {
      const c = confidenceMap.get(s.matchId);
      if (!c) return true; // sem resolver = assume normal
      if (c.mode === 'discard')   { confDiscarded++; return false; }
      if (c.mode === 'info_only') { confInfo++; return false; }
      if (c.mode === 'conservative') {
        // Modo conservador: exige confiança ≥85 + RMA CONFIRMADO + EV > 0.03
        if (s.probability < 85 || s.rmaVerdict !== 'CONFIRMADO' || s.ev <= 0.03) {
          confConservative++;
          console.log(`[SNIPER-DUAL][CONFIDENCE] 🟡 conservador descartou ${s.match} ${s.market} (prob=${s.probability}, rma=${s.rmaVerdict}, ev=${s.ev})`);
          return false;
        }
      }
      return true;
    });
    console.log(`[SNIPER-DUAL][CONFIDENCE] discard=${confDiscarded} info_only=${confInfo} conservative_skip=${confConservative} keep=${newSignals.length}`);

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
    const sentThisRun = new Set<string>();
    for (const signal of approved) {
      const runKey = String(signal.matchId || signal.match).trim().toLowerCase();
      if (sentThisRun.has(runKey)) continue; // 1 sinal por jogo por execução
      sentThisRun.add(runKey);
      // Centraliza envio, claim atômico, dedupe e auditoria no telegram-signal.
      const tgRes = await fetch(`${supabaseUrl}/functions/v1/telegram-signal`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          match: signal.match,
          matchId: signal.matchId,
          market: signal.market,
          confidence: signal.probability,
          filtersValidated: `Sniper Dual • Score ${signal.score}`,
          sensitivity: 'sniper-dual',
          minute: signal.minute,
          score: `${signal.homeGoals} x ${signal.awayGoals}`,
          oddMin: String(signal.odd),
          reason: `Sniper Dual • Odd ref. ${signal.odd} • Pressão ${signal.pressure}% • ${signal.ritmo} • RMA ${signal.rmaVerdict}`,
          pressure: signal.pressure,
          dangerousAttacks: signal.dangerousAttacks,
          totalShots: signal.totalShots,
          shotsOnGoal: signal.shotsOnGoal,
        }),
      });
      const tgData = await tgRes.json().catch(() => ({}));

      if (signal.rmaVerdict) {
        await supabase.from('rma_shadow_logs').insert({
          match_id: signal.matchId, match_name: signal.match, market: signal.market,
          minute: signal.minute, original_signal: `${signal.market} ${signal.probability}%`,
          rma_verdict: signal.rmaVerdict, rma_score: signal.rmaScore || 0, pressure: signal.pressure,
        });
      }

      if (tgRes.ok && tgData.success && !tgData.deduped) sentCount++;
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
