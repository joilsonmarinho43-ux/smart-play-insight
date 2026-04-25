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
  if (ap_norm < 1.5) return { verdict: 'BLOQUEADO', score: rma_score };
  if (pressure > 60 && da === 0) return { verdict: 'BLOQUEADO', score: rma_score };
  if (sot_norm === 0) return { verdict: 'NEUTRO', score: rma_score };
  const verdict = rma_score > 40 ? 'CONFIRMADO' as const : rma_score >= 20 ? 'NEUTRO' as const : 'BLOQUEADO' as const;
  return { verdict, score: Math.round(rma_score * 100) / 100 };
}

// ═══════════════════════════════════════
// HYBRID ENGINE (server-side, no localStorage)
// ═══════════════════════════════════════

type HybridTier = 'SNIPER' | 'SEMI';

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
  // Pressure: weighted sum without /5 divisor to produce realistic 0-100 values
  const pressure = Math.min(100, Math.max(0, da * 2 + corners * 4 + sog * 8));
  const homeTeam = match.teams?.home?.name || 'Casa';
  const awayTeam = match.teams?.away?.name || 'Fora';
  const matchId = String(match.id || match.fixture?.id);
  const league = match.league || '';
  const hasStats = !!(lH.shotsOnGoal || lA.shotsOnGoal || lH.dangerousAttacks || lA.dangerousAttacks || totalShots || corners);

  return { minute, homeGoals, awayGoals, sog, totalShots, corners, da, daEstimated, dominantPoss, pressure, homeTeam, awayTeam, matchId, league, hasStats };
}

function classifyServer(match: any): HybridSignal | null {
  const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE'];
  const status = String(match?.fixture?.status?.short || '').toUpperCase();
  const isLive = match?.isLive === true || liveStatuses.includes(status);
  if (!isLive) return null;

  const s = extractStats(match);
  if (!s.hasStats) return null;

  // SNIPER criteria — high-pressure 0x0 early window
  const isSniper = s.minute >= 5 && s.minute <= 35 &&
    s.homeGoals === 0 && s.awayGoals === 0 &&
    s.sog >= 2 && s.dominantPoss >= 55 && s.da >= 6 && s.corners >= 2 && s.pressure >= 50;

  // SEMI criteria — janela apertada por placar para preservar assertividade do Over 1.5
  // 0x0: até min 35 (precisa tempo p/ 2 gols) | 1x0 ou 0x1: até min 50 (precisa tempo p/ 1 gol)
  const totalGoals = s.homeGoals + s.awayGoals;
  const semiWindowOk =
    (totalGoals === 0 && s.minute >= 5 && s.minute <= 35) ||
    (totalGoals === 1 && s.minute >= 5 && s.minute <= 50);
  const isSemi = !isSniper && semiWindowOk &&
    s.sog >= 1 && s.dominantPoss >= 50 && s.da >= 4 && s.corners >= 1 && s.pressure >= 30;

  if (!isSniper && !isSemi) return null;

  const tier: HybridTier = isSniper ? 'SNIPER' : 'SEMI';
  const market = 'Over 1.5';

  // Count validated filters
  const filters = [
    s.sog >= (isSniper ? 2 : 1),
    s.dominantPoss >= (isSniper ? 60 : 55),
    s.da >= (isSniper ? 6 : 4),
    s.corners >= (isSniper ? 2 : 1),
    s.pressure >= (isSniper ? 70 : 60),
  ];
  const validated = filters.filter(Boolean).length;

  const confidence = isSniper
    ? Math.min(95, 70 + Math.round(s.pressure / 10) + validated * 2)
    : Math.min(85, 60 + Math.round(s.pressure / 15) + validated * 2);

  return {
    matchId: s.matchId,
    match: `${s.homeTeam} vs ${s.awayTeam}`,
    league: s.league,
    minute: s.minute,
    tier,
    label: isSniper ? 'SNIPER 🔥' : 'SEMI ⚡',
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
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const API_FUTEBOL_KEY = Deno.env.get('API_FUTEBOL_KEY');

    if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey || !API_FUTEBOL_KEY) {
      throw new Error('Variáveis de ambiente não configuradas');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch live matches via football-api edge function
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

    // 2. Get today's already-signaled match IDs to avoid duplicates
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: existingSignals } = await supabase
      .from('telegram_signals')
      .select('match_id')
      .gte('created_at', todayStart.toISOString())
      .eq('success', true);

    const signaledIds = new Set((existingSignals || []).map((s: any) => s.match_id).filter(Boolean));

    // 3. Daily limit: max 25 signals/day
    const dailyCount = existingSignals?.length || 0;
    if (dailyCount >= 25) {
      console.log('[AUTO-MODE-SERVER] Limite diário de 25 sinais atingido');
      return new Response(JSON.stringify({ success: true, signals: 0, message: 'Limite diário atingido (25/25)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Classify each match + RMA gate
    const signalsToSend: HybridSignal[] = [];
    let rmaBlocked = 0;
    for (const match of matches) {
      const s = extractStats(match);
      if (s.hasStats) {
        console.log(`[AUTO-MODE-SERVER] ${s.homeTeam} vs ${s.awayTeam} | min:${s.minute} sog:${s.sog} da:${s.da}${s.daEstimated?'≈':''} crn:${s.corners} poss:${s.dominantPoss} prs:${Math.round(s.pressure)} score:${s.homeGoals}-${s.awayGoals}`);
      }
      const signal = classifyServer(match);
      if (!signal) continue;
      if (signaledIds.has(signal.matchId)) continue;

      // ═══ RMA GATE ═══
      const rma = evaluateRMAServer(signal.minute, signal.pressure, signal.dangerousAttacks, signal.totalShots, signal.shotsOnGoal);
      if (rma.verdict === 'BLOQUEADO') {
        console.log(`[AUTO-MODE-SERVER] 🔴 RMA BLOQUEOU: ${signal.match} • ${signal.market} (score: ${rma.score})`);
        await supabase.from('rma_shadow_logs').insert({
          match_id: signal.matchId,
          match_name: signal.match,
          market: signal.market,
          minute: signal.minute,
          original_signal: `${signal.label} ${signal.market} ${signal.confidence}%`,
          rma_verdict: 'BLOQUEADO',
          rma_score: rma.score,
          pressure: signal.pressure,
          block_reason: 'Auto-Mode — sinal bloqueado pelo RMA',
        });
        rmaBlocked++;
        continue;
      }

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
