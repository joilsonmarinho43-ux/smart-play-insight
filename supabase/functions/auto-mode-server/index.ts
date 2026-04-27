import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

// ═══════════════════════════════════════
// RMA ENGINE (inline) — pesos rebalanceados + league_weight + momentum
// ═══════════════════════════════════════
function evaluateRMAServer(
  minute: number,
  pressure: number,
  da: number,
  shots: number,
  sot: number,
  leagueWeight = 0,
  momentumDelta = 0,
): { verdict: 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO'; score: number } {
  const safeMin = Math.max(minute, 1);
  const ap_norm = (da / safeMin) * 10;
  const f_norm = (shots / safeMin) * 10;
  const sot_norm = (sot / safeMin) * 10;
  // Pesos novos: pressão 0.30, ap 0.35, f 0.15, sot 0.20
  let rma_score = (pressure * 0.30) + (ap_norm * 0.35) + (f_norm * 0.15) + (sot_norm * 0.20);
  rma_score += leagueWeight + momentumDelta;
  if (ap_norm < 1.5) return { verdict: 'BLOQUEADO', score: rma_score };
  if (pressure > 60 && da === 0) return { verdict: 'BLOQUEADO', score: rma_score };
  if (sot_norm === 0) return { verdict: 'NEUTRO', score: rma_score };
  const verdict = rma_score > 40 ? 'CONFIRMADO' as const : rma_score >= 20 ? 'NEUTRO' as const : 'BLOQUEADO' as const;
  return { verdict, score: Math.round(rma_score * 100) / 100 };
}

// ═══════════════════════════════════════
// LEAGUE WEIGHT — qualidade estatística da liga
// ═══════════════════════════════════════
const ELITE_LEAGUES = [
  'premier league', 'la liga', 'laliga', 'serie a', 'bundesliga', 'ligue 1',
  'champions league', 'uefa champions',
];
const UNSTABLE_PATTERNS = [
  'friendly', 'amistoso', 'reserve', 'reservas', 'u20', 'u-20', 'u19', 'u-19',
  'u18', 'u-18', 'u17', 'u-17', 'sub-20', 'sub20', 'sub-19', 'sub19', 'sub-17',
  'youth', 'juvenil', 'women', 'feminin', 'feminina', 'wom', ' w ', ' w.', 'amateur',
];
function getLeagueWeight(league: string): number {
  const l = (league || '').toLowerCase();
  if (!l) return 0;
  if (ELITE_LEAGUES.some((k) => l.includes(k))) return 5;
  if (UNSTABLE_PATTERNS.some((k) => l.includes(k))) return -5;
  return 0;
}

// ═══════════════════════════════════════
// MOMENTUM CACHE — leitura dos últimos ~5 min por jogo
// ═══════════════════════════════════════
interface MomentumSnapshot {
  minute: number;
  sog: number;
  da: number;
  corners: number;
  pressure: number;
  ts: number;
}
const momentumCache = new Map<string, MomentumSnapshot[]>();

function pushMomentum(matchId: string, snap: MomentumSnapshot) {
  const arr = momentumCache.get(matchId) || [];
  arr.push(snap);
  // mantém apenas últimos 10 min de leituras
  const cutoff = snap.minute - 10;
  const trimmed = arr.filter((x) => x.minute >= cutoff);
  momentumCache.set(matchId, trimmed);
}

function getMomentumDelta(matchId: string, current: MomentumSnapshot): number {
  const arr = momentumCache.get(matchId) || [];
  // procura snapshot ~5 min atrás
  const past = [...arr].reverse().find((x) => current.minute - x.minute >= 4 && current.minute - x.minute <= 7);
  if (!past) return 0;
  const dSog = current.sog - past.sog;
  const dDa = current.da - past.da;
  const dCorners = current.corners - past.corners;
  const dPressure = current.pressure - past.pressure;
  // score de momentum
  let m = dSog * 2 + dCorners * 1.5 + dDa * 0.25 + dPressure * 0.05;
  // clamp
  if (m > 6) m = 6;
  if (m < -6) m = -6;
  if (m > 0 && m < 3) m = 3; // mínimo positivo relevante
  if (m < 0 && m > -3) m = -3; // mínimo penalidade
  if (Math.abs(m) < 1) return 0;
  return Math.round(m);
}

// ═══════════════════════════════════════
// HYBRID ENGINE (server-side, no localStorage)
// ═══════════════════════════════════════

type HybridTier = 'SUPER_SNIPER' | 'SNIPER' | 'SEMI';

interface HybridSignal {
  matchId: string;
  match: string;
  league: string;
  minute: number;
  tier: HybridTier;
  label: string;
  market: string;
  confidence: number;
  shotsOnGoal: number;
  totalShots: number;
  corners: number;
  dangerousAttacks: number;
  daEstimated: boolean;
  possession: number;
  pressure: number;
  homeGoals: number;
  awayGoals: number;
  filtersValidated: string;
}

function extractStats(match: any) {
  const minute = match.fixture?.status?.elapsed || 0;
  const homeGoals = match.goals?.home ?? 0;
  const awayGoals = match.goals?.away ?? 0;
  const lH = match.stats?.home || {};
  const lA = match.stats?.away || {};
  const sog = (lH.shotsOnGoal || 0) + (lA.shotsOnGoal || 0);
  const totalShots = (lH.totalShots || 0) + (lA.totalShots || 0);
  const corners = (lH.corners || 0) + (lA.corners || 0);

  let da = (lH.dangerousAttacks || 0) + (lA.dangerousAttacks || 0);
  let daEstimated = false;
  if (da === 0 && (totalShots > 0 || corners > 0)) {
    da = Math.round(totalShots * 1.5 + corners * 2);
    daEstimated = true;
  }

  const homePoss = Number(lH.possession || 0);
  const awayPoss = Number(lA.possession || 0);
  const dominantPoss = Math.max(homePoss, awayPoss);
  const pressure = Math.min(100, Math.max(0, da * 2 + corners * 4 + sog * 8));
  const homeTeam = match.teams?.home?.name || 'Casa';
  const awayTeam = match.teams?.away?.name || 'Fora';
  const matchId = String(match.id || match.fixture?.id);
  const league = match.league || '';
  const hasStats = !!(lH.shotsOnGoal || lA.shotsOnGoal || lH.dangerousAttacks || lA.dangerousAttacks || totalShots || corners);

  return { minute, homeGoals, awayGoals, sog, totalShots, corners, da, daEstimated, dominantPoss, pressure, homeTeam, awayTeam, matchId, league, hasStats };
}

function classifyServer(match: any, rmaScorePreview: number): HybridSignal | null {
  const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE'];
  const status = String(match?.fixture?.status?.short || '').toUpperCase();
  const isLive = match?.isLive === true || liveStatuses.includes(status);
  if (!isLive) return null;

  const s = extractStats(match);
  if (!s.hasStats) return null;

  // 💀 SUPER SNIPER — premium, raro
  const isSuperSniper =
    s.homeGoals === 0 && s.awayGoals === 0 &&
    s.minute >= 12 && s.minute <= 28 &&
    s.sog >= 4 && s.da >= 12 && s.corners >= 3 &&
    s.dominantPoss >= 58 && s.pressure >= 75 &&
    rmaScorePreview >= 28;

  // SNIPER (agressivo)
  const isSniper = !isSuperSniper && s.minute >= 5 && s.minute <= 30 &&
    s.homeGoals === 0 && s.awayGoals === 0 &&
    s.sog >= 3 && s.dominantPoss >= 55 && s.da >= 8 && s.corners >= 2 && s.pressure >= 60;

  // SEMI
  const totalGoals = s.homeGoals + s.awayGoals;
  const semiWindowOk =
    (totalGoals === 0 && s.minute >= 5 && s.minute <= 30) ||
    (totalGoals === 1 && s.minute >= 5 && s.minute <= 45);
  const isSemi = !isSuperSniper && !isSniper && semiWindowOk &&
    s.sog >= 1 && s.dominantPoss >= 50 && s.da >= 4 && s.corners >= 1 && s.pressure >= 30;

  if (!isSuperSniper && !isSniper && !isSemi) return null;

  const tier: HybridTier = isSuperSniper ? 'SUPER_SNIPER' : isSniper ? 'SNIPER' : 'SEMI';
  const market = 'Over 1.5';

  // Filtros validados (escala por tier)
  const filterThresholds = isSuperSniper
    ? { sog: 3, poss: 58, da: 10, crn: 3, prs: 75 }
    : isSniper
      ? { sog: 2, poss: 60, da: 6, crn: 2, prs: 70 }
      : { sog: 1, poss: 55, da: 4, crn: 1, prs: 60 };
  const filters = [
    s.sog >= filterThresholds.sog,
    s.dominantPoss >= filterThresholds.poss,
    s.da >= filterThresholds.da,
    s.corners >= filterThresholds.crn,
    s.pressure >= filterThresholds.prs,
  ];
  const validated = filters.filter(Boolean).length;

  const confidence = isSuperSniper
    ? Math.min(98, 82 + Math.round(s.pressure / 8) + validated * 2)
    : isSniper
      ? Math.min(95, 70 + Math.round(s.pressure / 10) + validated * 2)
      : Math.min(85, 60 + Math.round(s.pressure / 15) + validated * 2);

  const label = isSuperSniper ? 'SUPER SNIPER 💀' : isSniper ? 'SNIPER 🔥' : 'SEMI ⚡';

  return {
    matchId: s.matchId,
    match: `${s.homeTeam} vs ${s.awayTeam}`,
    league: s.league,
    minute: s.minute,
    tier,
    label,
    market,
    confidence,
    shotsOnGoal: s.sog,
    totalShots: s.totalShots,
    corners: s.corners,
    dangerousAttacks: s.da,
    daEstimated: s.daEstimated,
    possession: s.dominantPoss,
    pressure: Math.round(s.pressure),
    homeGoals: s.homeGoals,
    awayGoals: s.awayGoals,
    filtersValidated: `${validated}/5`,
  };
}

    // 4. Classify each match + RMA gate (com momentum e league_weight)
    const signalsToSend: HybridSignal[] = [];
    let rmaBlocked = 0;
    const nowTs = Date.now();
    for (const match of matches) {
      const s = extractStats(match);
      if (s.hasStats) {
        console.log(`[AUTO-MODE-SERVER] ${s.homeTeam} vs ${s.awayTeam} | min:${s.minute} sog:${s.sog} da:${s.da}${s.daEstimated?'≈':''} crn:${s.corners} poss:${s.dominantPoss} prs:${Math.round(s.pressure)} score:${s.homeGoals}-${s.awayGoals}`);
      }
      if (!s.hasStats || !s.matchId) continue;

      // Momentum: snapshot atual + delta vs ~5 min atrás
      const snap: MomentumSnapshot = { minute: s.minute, sog: s.sog, da: s.da, corners: s.corners, pressure: s.pressure, ts: nowTs };
      const momentumDelta = getMomentumDelta(s.matchId, snap);
      pushMomentum(s.matchId, snap);

      // League weight
      const leagueWeight = getLeagueWeight(s.league);

      // RMA com ajustes (usado também como preview para SUPER SNIPER)
      const rma = evaluateRMAServer(s.minute, s.pressure, s.da, s.totalShots, s.sog, leagueWeight, momentumDelta);

      const signal = classifyServer(match, rma.score);
      if (!signal) continue;
      if (signaledIds.has(signal.matchId)) continue;

      if (rma.verdict === 'BLOQUEADO') {
        console.log(`[AUTO-MODE-SERVER] 🔴 RMA BLOQUEOU: ${signal.match} • ${signal.market} (score:${rma.score} lw:${leagueWeight} mom:${momentumDelta})`);
        await supabase.from('rma_shadow_logs').insert({
          match_id: signal.matchId,
          match_name: signal.match,
          market: signal.market,
          minute: signal.minute,
          original_signal: `${signal.label} ${signal.market} ${signal.confidence}%`,
          rma_verdict: 'BLOQUEADO',
          rma_score: rma.score,
          pressure: signal.pressure,
          block_reason: `Auto-Mode — RMA bloqueou (lw:${leagueWeight}, mom:${momentumDelta})`,
        });
        rmaBlocked++;
        continue;
      }

      // Aplica league_weight + momentum também na confiança final
      signal.confidence = Math.max(0, Math.min(99, signal.confidence + leagueWeight + momentumDelta));
      signal.filtersValidated = `${signal.filtersValidated} • lw${leagueWeight >= 0 ? '+' : ''}${leagueWeight} • mom${momentumDelta >= 0 ? '+' : ''}${momentumDelta}`;

      signalsToSend.push(signal);
      if (signalsToSend.length + dailyCount >= 25) break;
    }

    console.log(`[AUTO-MODE-SERVER] ${signalsToSend.length} aprovados, ${rmaBlocked} bloqueados pelo RMA`);

    // 5. Send each signal via telegram-signal edge function
    let sentCount = 0;
    for (const signal of signalsToSend) {
      try {
        const score = `${signal.homeGoals} x ${signal.awayGoals}`;

        const tgPayload = {
          match: signal.match,
          matchId: signal.matchId,
          market: signal.market,
          confidence: signal.confidence,
          filtersValidated: signal.filtersValidated,
          sensitivity: signal.tier === 'SNIPER' ? 'agressivo' : 'moderado',
          minute: signal.minute,
          score,
          reason: `Auto-Mode • ${signal.label} • Pressão ${signal.pressure} • DA ${signal.dangerousAttacks}${signal.daEstimated ? '≈' : ''}`,
          pressure: signal.pressure,
          dangerousAttacks: signal.dangerousAttacks,
          totalShots: signal.totalShots,
          shotsOnGoal: signal.shotsOnGoal,
        };

        const tgRes = await fetch(`${supabaseUrl}/functions/v1/telegram-signal`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tgPayload),
        });

        const tgData = await tgRes.json();

        if (tgRes.ok && tgData.success) {
          sentCount++;
          console.log(`[AUTO-MODE-SERVER] ✅ ${signal.match} • ${signal.label}`);
        } else {
          console.log(`[AUTO-MODE-SERVER] ❌ ${signal.match} • ${JSON.stringify(tgData)}`);
        }

      } catch (err) {
        console.error(`[AUTO-MODE-SERVER] Erro ao enviar sinal:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, signals: sentCount, analyzed: matches.length, qualified: signalsToSend.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[AUTO-MODE-SERVER] Erro:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
