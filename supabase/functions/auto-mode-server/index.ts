import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

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
  const totalShots = (lH.totalShots || 0) + (lA.totalShots || 0) + sog;
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
  const pressure = Math.min(100, Math.max(0, (da * 3 + corners * 5 + sog * 10) / 5));
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

  // SNIPER criteria
  const isSniper = s.minute >= 5 && s.minute <= 30 &&
    s.homeGoals === 0 && s.awayGoals === 0 &&
    s.sog >= 2 && s.dominantPoss >= 60 && s.da >= 8 && s.corners >= 2 && s.pressure >= 70;

  // SEMI criteria
  const validScore = (s.homeGoals === 0 && s.awayGoals === 0) || (s.homeGoals + s.awayGoals === 1);
  const isSemi = !isSniper && s.minute >= 5 && s.minute <= 35 &&
    validScore && s.sog >= 1 && s.dominantPoss >= 55 && s.da >= 6 && s.corners >= 1 && s.pressure >= 60;

  if (!isSniper && !isSemi) return null;

  // SEMI must be in execution window
  if (isSemi && (s.minute < 10 || s.minute > 30)) return null;

  const tier: HybridTier = isSniper ? 'SNIPER' : 'SEMI';
  const market = isSniper ? 'Over 0.5 HT' : (s.homeGoals + s.awayGoals === 0 ? 'Over 0.5' : 'Over 1.5');

  // Count validated filters
  const filters = [
    s.sog >= (isSniper ? 2 : 1),
    s.dominantPoss >= (isSniper ? 60 : 55),
    s.da >= (isSniper ? 8 : 6),
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

    // 3. Daily limit: max 5 signals/day
    const dailyCount = existingSignals?.length || 0;
    if (dailyCount >= 5) {
      console.log('[AUTO-MODE-SERVER] Limite diário de 5 sinais atingido');
      return new Response(JSON.stringify({ success: true, signals: 0, message: 'Limite diário atingido (5/5)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Classify each match
    const signalsToSend: HybridSignal[] = [];
    for (const match of matches) {
      const signal = classifyServer(match);
      if (!signal) continue;
      if (signaledIds.has(signal.matchId)) continue;
      signalsToSend.push(signal);
      if (signalsToSend.length + dailyCount >= 5) break;
    }

    console.log(`[AUTO-MODE-SERVER] ${signalsToSend.length} sinais qualificados`);

    // 5. Send each signal to Telegram and log
    let sentCount = 0;
    for (const signal of signalsToSend) {
      try {
        const emoji = signal.tier === 'SNIPER' ? '🔥' : '⚡';
        const score = `${signal.homeGoals}-${signal.awayGoals}`;

        const text = [
          `━━━━━━━━━━━━━━━━━━━━━`,
          `${emoji} <b>SINAL AUTOMÁTICO • ${signal.label}</b>`,
          `━━━━━━━━━━━━━━━━━━━━━`,
          ``,
          `⚽ <b>${signal.match}</b>`,
          `🏆 ${signal.league}`,
          `⏱ Minuto: <b>${signal.minute}'</b>`,
          `📈 Mercado: <b>${signal.market}</b>`,
          `🎯 Confiança: <b>${signal.confidence}%</b>`,
          `📊 Placar: <b>${score}</b>`,
          `✅ Filtros: <b>${signal.filtersValidated}</b>`,
          ``,
          `📉 Pressão: <b>${signal.pressure}</b> | SoG: <b>${signal.shotsOnGoal}</b>`,
          `🔄 Posse: <b>${signal.possession}%</b> | Cantos: <b>${signal.corners}</b>`,
          signal.daEstimated ? `⚠️ DA estimado via fallback` : null,
          ``,
          `⏳ Status: <b>PENDENTE</b>`,
          ``,
          `━━━━━━━━━━━━━━━━━━━━━`,
          `🤖 <i>Analista Joilson • Auto-Mode Server</i>`,
        ].filter(Boolean).join('\n');

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
          confidence: signal.confidence,
          filters_validated: signal.filtersValidated,
          sensitivity: signal.tier === 'SNIPER' ? 'agressivo' : 'moderado',
          minute: signal.minute,
          score,
          reason: `Auto-Mode Server • ${signal.label}`,
          success: tgRes.ok,
          error_message: tgRes.ok ? null : JSON.stringify(tgData),
          telegram_message_id: telegramMessageId,
          status: 'pendente',
        });

        if (tgRes.ok) sentCount++;
        console.log(`[AUTO-MODE-SERVER] ${tgRes.ok ? '✅' : '❌'} ${signal.match} • ${signal.label}`);

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
