import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

// Market verification logic
function checkMarketResult(market: string, homeGoals: number, awayGoals: number, corners: number, matchFinished: boolean): 'green' | 'loss' | 'pendente' {
  const totalGoals = homeGoals + awayGoals;
  const marketLower = market.toLowerCase();

  // Over goals markets
  const overMatch = marketLower.match(/over\s*(\d+\.?\d*)\s*(?:gols|goals)?/);
  if (overMatch) {
    const threshold = parseFloat(overMatch[1]);
    if (totalGoals > threshold) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  // Under goals markets
  const underMatch = marketLower.match(/under\s*(\d+\.?\d*)\s*(?:gols|goals)?/);
  if (underMatch) {
    const threshold = parseFloat(underMatch[1]);
    if (totalGoals >= threshold) return 'loss'; // already exceeded
    if (matchFinished) return 'green';
    return 'pendente';
  }

  // BTTS / Ambas Marcam
  if (marketLower.includes('btts') || marketLower.includes('ambas marcam')) {
    if (homeGoals > 0 && awayGoals > 0) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  // Over corners
  const cornerMatch = marketLower.match(/over\s*(\d+\.?\d*)\s*(?:escanteios|corners)/);
  if (cornerMatch) {
    const threshold = parseFloat(cornerMatch[1]);
    if (corners > threshold) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  // Gol no 2T / Second half goal
  if (marketLower.includes('gol no 2t') || marketLower.includes('gol 2t')) {
    // We can't distinguish 1st/2nd half goals easily from total score alone
    // If match finished and total goals > score at HT, that would be green
    // For simplicity: if match finished, check if goals happened (heuristic)
    if (matchFinished) {
      return totalGoals > 0 ? 'green' : 'loss';
    }
    return 'pendente';
  }

  // If we can't parse the market, only resolve when finished
  if (matchFinished) return 'loss';
  return 'pendente';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    if (!TELEGRAM_API_KEY) throw new Error('TELEGRAM_API_KEY not configured');

    const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');

    const API_KEY = Deno.env.get('API_FUTEBOL_KEY');
    if (!API_KEY) throw new Error('API_FUTEBOL_KEY not configured');

    // Fetch pending signals
    const { data: pendingSignals, error: fetchErr } = await sb
      .from('telegram_signals')
      .select('*')
      .eq('status', 'pendente')
      .not('match_id', 'is', null);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!pendingSignals || pendingSignals.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'No pending signals' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group by match_id to minimize API calls
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
              const cornerStat = team.statistics?.find((s: any) => s.type === 'Corner Kicks');
              return sum + (cornerStat?.value ?? 0);
            }, 0),
            finished: ['FT', 'AET', 'PEN'].includes(fixture.fixture?.status?.short),
            status: fixture.fixture?.status?.short,
          };
        }
      } catch (e) {
        console.error(`Failed to fetch match ${matchId}:`, e);
      }
      // Small delay between API calls
      await new Promise(r => setTimeout(r, 200));
    }

    let processed = 0;
    const results: Array<{ id: string; status: string }> = [];

    for (const signal of pendingSignals) {
      const data = matchData[signal.match_id];
      if (!data) continue;

      // Check if signal is older than 3 hours (safety timeout)
      const signalAge = Date.now() - new Date(signal.created_at).getTime();
      const timedOut = signalAge > 3 * 60 * 60 * 1000;

      let newStatus = checkMarketResult(
        signal.market,
        data.homeGoals,
        data.awayGoals,
        data.corners,
        data.finished || timedOut
      );

      if (newStatus === 'pendente') continue;

      // Update status in DB
      const { error: updateErr } = await sb
        .from('telegram_signals')
        .update({ status: newStatus })
        .eq('id', signal.id);

      if (updateErr) {
        console.error(`Failed to update signal ${signal.id}:`, updateErr);
        continue;
      }

      // Edit Telegram message
      if (signal.telegram_message_id) {
        try {
          const resultHeader = newStatus === 'green'
            ? `\n\n✅✅✅ GREEN GREEN GREEN ✅✅✅\n📊 Placar Final: ${data.homeGoals} x ${data.awayGoals}`
            : `\n\n❌ LOSS (Ficou no quase)\n📊 Placar Final: ${data.homeGoals} x ${data.awayGoals}`;

          // We need to reconstruct the original message and append result
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
              chat_id: CHAT_ID,
              message_id: signal.telegram_message_id,
              text: updatedText,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          });
        } catch (e) {
          console.error(`Failed to edit Telegram message for signal ${signal.id}:`, e);
        }
      }

      processed++;
      results.push({ id: signal.id, status: newStatus });
    }

    return new Response(JSON.stringify({ success: true, processed, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Check signal results error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
