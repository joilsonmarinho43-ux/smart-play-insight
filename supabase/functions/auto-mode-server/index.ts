import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { dynamicConfidence, isDynamicConfidenceEnabled } from '../_shared/dynamicConfidence.ts';
import { isWorldCupLeague } from '../_shared/worldCup.ts';
import { classifyConfidence, resolveMatchConfidence, logConfidenceDecision } from '../_shared/confidencePolicy.ts';
import { projectGoals } from '../_shared/goalProjection.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  daEstimated = false,
): { verdict: 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO'; score: number; blockReason?: string } {
  const safeMin = Math.max(minute, 1);
  const ap_norm = (da / safeMin) * 10;
  const f_norm = (shots / safeMin) * 10;
  const sot_norm = (sot / safeMin) * 10;
  // Pesos: pressão 0.30, ap 0.35, f 0.15, sot 0.20
  let rma_score = (pressure * 0.30) + (ap_norm * 0.35) + (f_norm * 0.15) + (sot_norm * 0.20);
  rma_score += leagueWeight + momentumDelta;

  // ── HARD BLOCK 1: pressão fake premium (endurecido) ──
  // pressão alta + DA estimado + SoG fraco = ilusão estatística
  if (pressure > 70 && sot <= 2 && daEstimated) {
    return { verdict: 'BLOQUEADO', score: rma_score, blockReason: 'Pressão fake premium (prs>70, SoG≤2, DA estimado)' };
  }

  // ── HARD BLOCK 2: SoG por minuto muito baixo (sem finalização real) ──
  if (sot_norm < 0.6) {
    return { verdict: 'BLOQUEADO', score: rma_score, blockReason: `sot_norm baixo (${sot_norm.toFixed(2)})` };
  }

  if (ap_norm < 1.5) return { verdict: 'BLOQUEADO', score: rma_score, blockReason: 'ap_norm < 1.5' };
  if (pressure > 60 && da === 0) return { verdict: 'BLOQUEADO', score: rma_score, blockReason: 'Pressão alta sem DA' };
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
  // 🌍 Copa do Mundo FIFA tem prioridade ABSOLUTA — passa por cima de
  // qualquer match em UNSTABLE_PATTERNS (ex: "Friendlies International"
  // de preparação para a Copa) e recebe o maior peso possível.
  if (isWorldCupLeague(l)) return 6;
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

  // Novos indicadores de penetração / posse estéril
  const blockedShots = (lH.blockedShots || 0) + (lA.blockedShots || 0);
  const shotsInsideBox = (lH.shotsInsideBox || 0) + (lA.shotsInsideBox || 0);
  const attacks = (lH.attacks || 0) + (lA.attacks || 0);
  const passesAccurate = (lH.passesAccurate || 0) + (lA.passesAccurate || 0);

  const homePoss = Number(lH.possession || 0);
  const awayPoss = Number(lA.possession || 0);
  const dominantPoss = Math.max(homePoss, awayPoss);
  const pressure = Math.min(100, Math.max(0, da * 2 + corners * 4 + sog * 8));
  const homeTeam = match.teams?.home?.name || 'Casa';
  const awayTeam = match.teams?.away?.name || 'Fora';
  const matchId = String(match.id || match.fixture?.id);
  const league = typeof match.league === 'string' ? match.league : (match.league?.name || '');
  const hasStats = !!(lH.shotsOnGoal || lA.shotsOnGoal || lH.dangerousAttacks || lA.dangerousAttacks || totalShots || corners);

  return {
    minute, homeGoals, awayGoals, sog, totalShots, corners, da, daEstimated,
    blockedShots, shotsInsideBox, attacks, passesAccurate,
    dominantPoss, pressure, homeTeam, awayTeam, matchId, league, hasStats,
  };
}

/**
 * Detecta posse estéril: domínio territorial sem penetração real.
 * Bypass em jogos intensos (SoG≥3 ou pressão≥70) para preservar sensibilidade.
 * Retorna { sterile: boolean, reason: string }.
 */
function detectSterilePossession(s: ReturnType<typeof extractStats>): { sterile: boolean; reason: string } {
  // Bypass — jogo intenso, sinal real de gol
  if (s.sog >= 3 || s.pressure >= 70) return { sterile: false, reason: '' };
  // Só avalia após 20' (antes há ruído natural)
  if (s.minute < 20) return { sterile: false, reason: '' };

  // Domínio claro
  const dominant = s.dominantPoss >= 60;
  if (!dominant) return { sterile: false, reason: '' };

  // Indicadores de penetração real (qualquer um derruba a flag)
  const hasPenetration =
    s.shotsInsideBox >= 2 ||
    s.blockedShots >= 2 ||
    s.sog >= 2;

  if (hasPenetration) return { sterile: false, reason: '' };

  // Razão DA/Attacks: se vem da API real e está baixa, confirma jogo lateral
  if (s.attacks > 0 && !s.daEstimated) {
    const daRatio = s.da / Math.max(1, s.attacks);
    if (daRatio < 0.35) {
      return { sterile: true, reason: `posse ${s.dominantPoss}% sem penetração (DA/AT ${daRatio.toFixed(2)})` };
    }
  }

  // Sem indicadores de finalização interna após 20' com domínio = estéril
  return { sterile: true, reason: `posse ${s.dominantPoss}% sem finalização interna (SIB:${s.shotsInsideBox} BS:${s.blockedShots})` };
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

  // SNIPER (agressivo) — janela 8-28 (evita início ruidoso e min 29-30 instável)
  const isSniper = !isSuperSniper && s.minute >= 8 && s.minute <= 28 &&
    s.homeGoals === 0 && s.awayGoals === 0 &&
    s.sog >= 3 && s.dominantPoss >= 55 && s.da >= 8 && s.corners >= 2 && s.pressure >= 60;

  // SEMI — janela endurecida: 8-25 (0x0 em Over 1.5 exige DOIS gols; após 25' o tempo
  // restante não sustenta a probabilidade). Histórico pós-atualização: excesso de loss
  // vinha de SEMI fraco entre 26' e 35'.
  // 🔒 Anti-falso-positivo: SEMI só aceita DA REAL do feed.
  // 🔒 VALOR DE ODD: Over 1.5 só tem odd paga com placar 0x0.
  const totalGoals = s.homeGoals + s.awayGoals;
  const semiWindowOk = totalGoals === 0 && s.minute >= 8 && s.minute <= 25;
  const isSemi = !isSuperSniper && !isSniper && semiWindowOk &&
    !s.daEstimated &&
    s.sog >= 3 && s.dominantPoss >= 55 && s.da >= 8 && s.corners >= 2 && s.pressure >= 50;

  if (!isSuperSniper && !isSniper && !isSemi) return null;

  // 🔒 Filtro de posse estéril (aplicado apenas em SEMI; SNIPER/SUPER já têm SoG≥3)
  if (isSemi) {
    const sterile = detectSterilePossession(s);
    if (sterile.sterile) {
      console.log(`[AUTO-MODE-SERVER] ⚠️ Posse estéril bloqueada: ${s.homeTeam} vs ${s.awayTeam} • ${sterile.reason}`);
      return null;
    }
  }

  // 🔒 GATE POISSON — jogo 0x0 precisa de 2 gols para pagar Over 1.5.
  // Exige probabilidade real de ≥2 gols no tempo restante.
  if (totalGoals === 0) {
    const proj = projectGoals({
      minute: s.minute, sog: s.sog, totalShots: s.totalShots,
      da: s.da, corners: s.corners, pressure: s.pressure,
    });
    const minP2 = isSuperSniper ? 0.55 : isSniper ? 0.58 : 0.62;
    if (proj.probAtLeast2 < minP2) {
      console.log(`[AUTO-MODE-SERVER] 🔴 Poisson bloqueou: ${s.homeTeam} vs ${s.awayTeam} min ${s.minute} • P(≥2)=${(proj.probAtLeast2 * 100).toFixed(0)}% < ${(minP2 * 100).toFixed(0)}% (λ=${proj.lambdaRemaining})`);
      return null;
    }
  }


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

  let confidence = isSuperSniper
    ? Math.min(98, 82 + Math.round(s.pressure / 8) + validated * 2)
    : isSniper
      ? Math.min(95, 70 + Math.round(s.pressure / 10) + validated * 2)
      : Math.min(85, 60 + Math.round(s.pressure / 15) + validated * 2);

  if (isDynamicConfidenceEnabled()) {
    const dyn = dynamicConfidence(confidence, {
      minute: s.minute,
      homeGoals: s.homeGoals,
      awayGoals: s.awayGoals,
      sotTotal: s.sog,
      shotsTotal: s.totalShots,
      daTotal: s.da,
      pressure: s.pressure,
      pressureRecent: s.pressure,
      requiredGoals: 2,
    });
    console.log(`[DYN-CONF ${tier}] ${s.homeTeam} vs ${s.awayTeam} min ${s.minute}: ${confidence}% → ${dyn.confidence}% • ${dyn.reason}`);
    confidence = dyn.confidence;
  }

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
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ live: true }),
    });

    const footballData = await footballRes.json();
    const matches = footballData?.matches || [];
    console.log(`[AUTO-MODE-SERVER] ${matches.length} jogos ao vivo encontrados`);

    if (matches.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0, message: 'Nenhum jogo ao vivo' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Anti-spam: 1 sinal por jogo/dia (BRT — 00:00 São Paulo)
    const brtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const todayStartIso = `${brtDay}T03:00:00.000Z`;
    console.log(`[TIMEZONE] auto-mode day_brt=${brtDay} startIso=${todayStartIso}`);

    const { data: existingSignals } = await supabase
      .from('telegram_signals')
      .select('match_id')
      .gte('created_at', todayStartIso)
      .eq('success', true);

    const signaledIds = new Set((existingSignals || []).map((s: any) => s.match_id).filter(Boolean));

    // 3. Limite diário: 25 sinais
    const dailyCount = existingSignals?.length || 0;
    if (dailyCount >= 25) {
      console.log('[AUTO-MODE-SERVER] Limite diário de 25 sinais atingido');
      return new Response(JSON.stringify({ success: true, signals: 0, message: 'Limite diário atingido (25/25)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Classify each match + RMA gate (com momentum e league_weight)
    const signalsToSend: HybridSignal[] = [];
    let rmaBlocked = 0;
    const nowTs = Date.now();
    for (const match of matches) {
      const s = extractStats(match);
      const isWC = isWorldCupLeague(s.league);
      if (isWC) {
        console.log(`[WORLD_CUP_DETECTED] ${s.homeTeam} vs ${s.awayTeam} | liga="${s.league}" min:${s.minute} sog:${s.sog} da:${s.da}${s.daEstimated?'≈':''} score:${s.homeGoals}-${s.awayGoals}`);
      }
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
      const rma = evaluateRMAServer(s.minute, s.pressure, s.da, s.totalShots, s.sog, leagueWeight, momentumDelta, s.daEstimated);

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
          block_reason: rma.blockReason || `Auto-Mode — RMA bloqueou (lw:${leagueWeight}, mom:${momentumDelta})`,
        });
        rmaBlocked++;
        continue;
      }

      // ─── CONFIDENCE POLICY GATE ─────────────────────────────────
      const conf = await resolveMatchConfidence(supabaseUrl, supabaseKey, {
        matchId: signal.matchId, homeTeam: s.homeTeam, awayTeam: s.awayTeam, league: signal.league,
      });
      const policy = classifyConfidence(conf.score);
      logConfidenceDecision('AUTO-MODE', signal.match, conf.score, policy.mode, conf.source);
      if (policy.mode === 'discard' || policy.mode === 'info_only') {
        console.log(`[AUTO-MODE-SERVER] ${policy.mode === 'discard' ? '🔴' : '🔵'} CONFIDENCE ${policy.mode}: ${signal.match} score=${conf.score}`);
        continue;
      }
      if (policy.conservative) {
        // Modo conservador: só SUPER_SNIPER e SNIPER (sem SEMI) + confiança ≥80
        if (signal.tier === 'SEMI') {
          console.log(`[AUTO-MODE-SERVER] 🟡 CONSERVADOR rebaixou (skip SEMI): ${signal.match} score=${conf.score}`);
          continue;
        }
        if (signal.confidence < 80) {
          console.log(`[AUTO-MODE-SERVER] 🟡 CONSERVADOR rebaixou (conf<80): ${signal.match} conf=${signal.confidence}`);
          continue;
        }
        signal.filtersValidated = `${signal.filtersValidated} • 🟡cons(${conf.score})`;
      }

      // Aplica league_weight + momentum na confiança final (boost reduzido p/ evitar inflação)
      // Só permite boost positivo de momentum se houver SoG real (não inflar com pressão)
      const safeMomentum = signal.shotsOnGoal >= 3 ? momentumDelta : Math.min(momentumDelta, 0);
      signal.confidence = Math.max(0, Math.min(95, signal.confidence + leagueWeight + safeMomentum));
      signal.filtersValidated = `${signal.filtersValidated} • lw${leagueWeight >= 0 ? '+' : ''}${leagueWeight} • mom${safeMomentum >= 0 ? '+' : ''}${safeMomentum}`;

      signalsToSend.push(signal);
      if (isWorldCupLeague(signal.league)) {
        console.log(`[WORLD_CUP_SIGNAL_GENERATED] match_id=${signal.matchId} match="${signal.match}" liga="${signal.league}" min=${signal.minute} market="${signal.market}" conf=${signal.confidence}% tier=${signal.tier}`);
      }
      if (signalsToSend.length + dailyCount >= 25) break;
    }


    // 🌍 PRIORIDADE DE ENVIO: Copa do Mundo > Internacionais > Ligas Nacionais.
    // Reordena signalsToSend para que partidas da Copa sejam disparadas primeiro
    // (importante quando o limite diário de 25 está próximo).
    const leagueRank = (l: string): number => {
      if (isWorldCupLeague(l)) return 0;
      const lc = (l || '').toLowerCase();
      if (lc.includes('champions') || lc.includes('europa') || lc.includes('libertad') || lc.includes('sudameric') || lc.includes('uefa') || lc.includes('conmebol')) return 1;
      return 2;
    };
    signalsToSend.sort((a, b) => leagueRank(a.league) - leagueRank(b.league));

    console.log(`[AUTO-MODE-SERVER] ${signalsToSend.length} aprovados, ${rmaBlocked} bloqueados pelo RMA`);
    const wcCount = signalsToSend.filter(s => isWorldCupLeague(s.league)).length;
    if (wcCount > 0) console.log(`[WORLD_CUP_DETECTED] ${wcCount} sinais da Copa do Mundo serão enviados primeiro`);

    // 5. Send each signal via telegram-signal edge function
    let sentCount = 0;
    for (const signal of signalsToSend) {
      const isWC = isWorldCupLeague(signal.league);
      try {
        const score = `${signal.homeGoals} x ${signal.awayGoals}`;

        const tgPayload = {
          match: signal.match,
          matchId: signal.matchId,
          market: signal.market,
          confidence: signal.confidence,
          filtersValidated: signal.filtersValidated,
          sensitivity: signal.tier === 'SUPER_SNIPER' ? 'premium' : signal.tier === 'SNIPER' ? 'agressivo' : 'moderado',
          minute: signal.minute,
          score,
          reason: `${isWC ? '🌍 World Cup • ' : ''}Auto-Mode • ${signal.label} • Pressão ${signal.pressure} • DA ${signal.dangerousAttacks}${signal.daEstimated ? '≈' : ''}`,
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
          if (isWC) console.log(`[WORLD_CUP_TELEGRAM_SENT] match_id=${signal.matchId} match="${signal.match}" liga="${signal.league}" min=${signal.minute} market="${signal.market}" conf=${signal.confidence}%`);
        } else {
          console.log(`[AUTO-MODE-SERVER] ❌ ${signal.match} • ${JSON.stringify(tgData)}`);
          if (isWC) console.error(`[WORLD_CUP_ERROR] envio Telegram falhou match="${signal.match}" liga="${signal.league}" → ${JSON.stringify(tgData)}`);
        }

      } catch (err) {
        console.error(`[AUTO-MODE-SERVER] Erro ao enviar sinal:`, err);
        if (isWC) console.error(`[WORLD_CUP_ERROR] exceção ao enviar match="${signal.match}" liga="${signal.league}":`, err);
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
