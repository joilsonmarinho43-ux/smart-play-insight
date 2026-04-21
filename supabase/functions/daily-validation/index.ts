import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

// ═══════════════════════════════════════
// Market verification (same logic as check-signal-results)
// ═══════════════════════════════════════
function checkMarketResult(market: string, homeGoals: number, awayGoals: number, corners: number, matchFinished: boolean): 'green' | 'loss' | 'pendente' {
  const totalGoals = homeGoals + awayGoals;
  const ml = market.toLowerCase();

  const overMatch = ml.match(/over\s*(\d+\.?\d*)\s*(?:gols|goals)?/);
  if (overMatch) {
    const t = parseFloat(overMatch[1]);
    if (totalGoals > t) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  const underMatch = ml.match(/under\s*(\d+\.?\d*)\s*(?:gols|goals)?/);
  if (underMatch) {
    const t = parseFloat(underMatch[1]);
    if (totalGoals >= t) return 'loss';
    if (matchFinished) return 'green';
    return 'pendente';
  }

  if (ml.includes('btts') || ml.includes('ambas marcam')) {
    if (homeGoals > 0 && awayGoals > 0) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  const cornerMatch = ml.match(/over\s*(\d+\.?\d*)\s*(?:escanteios|corners)/);
  if (cornerMatch) {
    const t = parseFloat(cornerMatch[1]);
    if (corners > t) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  if (matchFinished) return 'loss';
  return 'pendente';
}

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
    const API_KEY = Deno.env.get('API_FUTEBOL_KEY');

    if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey || !API_KEY) {
      throw new Error('Variáveis de ambiente não configuradas');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── STEP 1: Validate all pending signals from last 24h ───
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: pendingSignals } = await supabase
      .from('telegram_signals')
      .select('*')
      .eq('status', 'pendente')
      .not('match_id', 'is', null)
      .gte('created_at', since);

    let validated = 0;

    if (pendingSignals && pendingSignals.length > 0) {
      const matchIds = [...new Set(pendingSignals.map(s => s.match_id).filter(Boolean))];
      const matchData: Record<string, any> = {};

      for (const matchId of matchIds) {
        try {
          const resp = await fetch(`https://v3.football.api-sports.io/fixtures?id=${matchId}`, {
            headers: { 'x-apisports-key': API_KEY },
          });
          const json = await resp.json();
          const fixture = json.response?.[0];
          if (fixture) {
            matchData[matchId] = {
              homeGoals: fixture.goals?.home ?? 0,
              awayGoals: fixture.goals?.away ?? 0,
              corners: (fixture.statistics || []).reduce((sum: number, team: any) => {
                const c = team.statistics?.find((s: any) => s.type === 'Corner Kicks');
                return sum + (c?.value ?? 0);
              }, 0),
              finished: ['FT', 'AET', 'PEN'].includes(fixture.fixture?.status?.short),
            };
          }
        } catch (e) {
          console.error(`Fetch match ${matchId} failed:`, e);
        }
        await new Promise(r => setTimeout(r, 200));
      }

      for (const signal of pendingSignals) {
        const data = matchData[signal.match_id];
        if (!data) continue;

        const signalAge = Date.now() - new Date(signal.created_at).getTime();
        const timedOut = signalAge > 3 * 60 * 60 * 1000;

        const newStatus = checkMarketResult(signal.market, data.homeGoals, data.awayGoals, data.corners, data.finished || timedOut);
        if (newStatus === 'pendente') continue;

        await supabase.from('telegram_signals').update({ status: newStatus }).eq('id', signal.id);

        // Edit Telegram message
        if (signal.telegram_message_id) {
          try {
            const emoji = signal.confidence >= 80 ? '🔥' : signal.confidence >= 70 ? '⚡' : '📊';
            const confBar = '🟢'.repeat(Math.round(signal.confidence / 20)) + '⚪'.repeat(5 - Math.round(signal.confidence / 20));
            const resultEmoji = newStatus === 'green' ? '✅' : '❌';
            const resultLabel = newStatus === 'green' ? 'GREEN' : 'LOSS';

            const updatedText = [
              `${emoji} <b>${signal.market}</b>`,
              ``,
              `⚽ ${signal.match_name} • ${signal.minute}'`,
              `📊 ${signal.score} ${confBar} ${signal.confidence}%`,
              ``,
              `${resultEmoji} <b>${resultLabel}</b> • Final: <b>${data.homeGoals} x ${data.awayGoals}</b>`,
              ``,
              `🤖 <i>Analista Joilson</i>`,
            ].join('\n');

            await fetch(`${GATEWAY_URL}/editMessageText`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'X-Connection-Api-Key': TELEGRAM_API_KEY,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                message_id: signal.telegram_message_id,
                text: updatedText,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
              }),
            });
          } catch (_) { /* ignore edit errors */ }
        }

        validated++;
      }
    }

    console.log(`[DAILY-VALIDATION] ${validated} sinais validados`);

    // ─── STEP 2: Generate 24h summary ───
    const { data: allSignals } = await supabase
      .from('telegram_signals')
      .select('*')
      .gte('created_at', since)
      .eq('success', true);

    const signals = allSignals || [];
    const total = signals.length;
    const greens = signals.filter(s => s.status === 'green').length;
    const losses = signals.filter(s => s.status === 'loss').length;
    const pending = signals.filter(s => s.status === 'pendente').length;
    const resolved = greens + losses;
    const winRate = resolved > 0 ? ((greens / resolved) * 100).toFixed(1) : '-';

    // Breakdown by market
    const marketStats: Record<string, { g: number; l: number }> = {};
    for (const s of signals) {
      if (s.status !== 'green' && s.status !== 'loss') continue;
      const key = s.market;
      if (!marketStats[key]) marketStats[key] = { g: 0, l: 0 };
      if (s.status === 'green') marketStats[key].g++;
      else marketStats[key].l++;
    }

    const marketLines = Object.entries(marketStats)
      .sort((a, b) => (b[1].g + b[1].l) - (a[1].g + a[1].l))
      .map(([market, { g, l }]) => {
        const wr = ((g / (g + l)) * 100).toFixed(0);
        return `  ${market}: ${g}✅ ${l}❌ (${wr}%)`;
      });

    // Confidence accuracy analysis
    const highConf = signals.filter(s => s.confidence >= 80 && (s.status === 'green' || s.status === 'loss'));
    const highConfGreens = highConf.filter(s => s.status === 'green').length;
    const highConfRate = highConf.length > 0 ? ((highConfGreens / highConf.length) * 100).toFixed(0) : '-';

    const lowConf = signals.filter(s => s.confidence < 70 && (s.status === 'green' || s.status === 'loss'));
    const lowConfGreens = lowConf.filter(s => s.status === 'green').length;
    const lowConfRate = lowConf.length > 0 ? ((lowConfGreens / lowConf.length) * 100).toFixed(0) : '-';

    // Financial estimate
    const stake = 20;
    const oddMedia = 1.75;
    const profit = greens * stake * (oddMedia - 1) - losses * stake;
    const roi = resolved > 0 ? ((profit / (resolved * stake)) * 100).toFixed(1) : '0';

    // Win rate bar
    const barLen = 10;
    const gBars = resolved > 0 ? Math.round((greens / resolved) * barLen) : 0;
    const bar = '🟢'.repeat(gBars) + '🔴'.repeat(barLen - gBars);

    const perfEmoji = parseFloat(winRate) >= 65 ? '🏆' : parseFloat(winRate) >= 50 ? '📊' : '⚠️';

    const message = [
      `${perfEmoji} <b>RESUMO 24H</b>`,
      ``,
      `${bar}`,
      `✅ ${greens} GREEN  ❌ ${losses} LOSS  ⏳ ${pending}`,
      `🎯 Win Rate: <b>${winRate}%</b> (${resolved} resolvidos)`,
      ``,
      `<b>Por mercado:</b>`,
      ...marketLines,
      ``,
      `<b>Por confiança:</b>`,
      `  ≥80%: ${highConfRate}% acerto (${highConf.length} sinais)`,
      `  <70%: ${lowConfRate}% acerto (${lowConf.length} sinais)`,
      ``,
      `💰 Lucro est.: <b>R$ ${profit.toFixed(2)}</b> • ROI: <b>${roi}%</b>`,
      ``,
      `🤖 <i>Analista Joilson • Relatório Diário</i>`,
    ].join('\n');

    // Send to Telegram
    const tgRes = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const tgData = await tgRes.json();

    return new Response(JSON.stringify({
      success: true,
      validated,
      summary: { total, greens, losses, pending, winRate, profit: profit.toFixed(2), roi },
      telegram_ok: tgRes.ok,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[DAILY-VALIDATION] Error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
