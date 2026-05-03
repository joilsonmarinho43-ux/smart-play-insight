import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { editTelegramMessage, getTelegramBotToken } from '../_shared/telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Market verification logic
function checkMarketResult(market: string, homeGoals: number, awayGoals: number, corners: number, matchFinished: boolean): 'green' | 'loss' | 'pendente' {
  const totalGoals = homeGoals + awayGoals;
  const marketLower = market.toLowerCase();

  const overMatch = marketLower.match(/over\s*(\d+\.?\d*)\s*(?:gols|goals)?/);
  if (overMatch) {
    const threshold = parseFloat(overMatch[1]);
    if (totalGoals > threshold) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  const underMatch = marketLower.match(/under\s*(\d+\.?\d*)\s*(?:gols|goals)?/);
  if (underMatch) {
    const threshold = parseFloat(underMatch[1]);
    if (totalGoals >= threshold) return 'loss';
    if (matchFinished) return 'green';
    return 'pendente';
  }

  if (marketLower.includes('btts') || marketLower.includes('ambas marcam')) {
    if (homeGoals > 0 && awayGoals > 0) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  const cornerMatch = marketLower.match(/over\s*(\d+\.?\d*)\s*(?:escanteios|corners)/);
  if (cornerMatch) {
    const threshold = parseFloat(cornerMatch[1]);
    if (corners > threshold) return 'green';
    if (matchFinished) return 'loss';
    return 'pendente';
  }

  if (marketLower.includes('gol no 2t') || marketLower.includes('gol 2t')) {
    if (matchFinished) {
      return totalGoals > 0 ? 'green' : 'loss';
    }
    return 'pendente';
  }

  // Over 0.5 HT — special handling
  if (marketLower.includes('over 0.5 ht') || marketLower.includes('over 0.5 1t')) {
    if (totalGoals > 0) return 'green';
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const TELEGRAM_BOT_TOKEN = getTelegramBotToken();

    const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');

    // Fetch pending signals + signals that resolved but Telegram edit failed
    const { data: pendingSignals, error: fetchErr } = await sb
      .from('telegram_signals')
      .select('*')
      .not('match_id', 'is', null)
      .or('status.eq.pendente,and(status.in.(green,loss),telegram_edited.eq.false)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!pendingSignals || pendingSignals.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'No pending signals' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══════════════════════════════════════
    // USE football-api EDGE FUNCTION (cached) instead of direct API calls
    // This reuses the 2-min LIVE cache, saving ~1400 API calls/day
    // ═══════════════════════════════════════
    const matchIds = [...new Set(pendingSignals.map(s => s.match_id).filter(Boolean))];
    const matchData: Record<string, any> = {};

    // Fetch live matches from cached football-api
    const liveRes = await fetch(`${supabaseUrl}/functions/v1/football-api`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ live: true }),
    });
    const liveData = await liveRes.json();
    const liveMatches = liveData?.matches || [];

    // Build lookup from live matches
    for (const m of liveMatches) {
      const mId = String(m.id || m.fixture?.id);
      if (matchIds.includes(mId)) {
        const status = m.fixture?.status?.short || '';
        const finished = ['FT', 'AET', 'PEN'].includes(status);
        
        // Get corners from stats if available
        let corners = 0;
        if (m.stats?.home?.corners != null || m.stats?.away?.corners != null) {
          corners = (m.stats?.home?.corners || 0) + (m.stats?.away?.corners || 0);
        }

        matchData[mId] = {
          homeGoals: m.goals?.home ?? 0,
          awayGoals: m.goals?.away ?? 0,
          corners,
          finished,
          status,
        };
      }
    }

    // For match IDs not found in live (already finished), check DB cache
    const missingIds = matchIds.filter(id => !matchData[id]);
    if (missingIds.length > 0) {
      // Try to get from cache_api (finished matches stay cached)
      for (const mId of missingIds) {
        const { data: cached } = await sb
          .from('cache_api')
          .select('dados_json')
          .eq('cache_key', `stats_${mId}`)
          .maybeSingle();

        if (cached?.dados_json) {
          const resArr = cached.dados_json.response || [];
          let corners = 0;
          for (const team of resArr) {
            const cornerStat = (team.statistics || []).find((s: any) => s.type === 'Corner Kicks');
            corners += (cornerStat?.value ?? 0);
          }
          // If we have cached stats, the match is likely finished
          matchData[mId] = {
            homeGoals: 0, awayGoals: 0, corners, finished: true, status: 'FT',
          };
        }
      }

      // For truly missing matches that need score, use a SINGLE bulk check via API
      const stillMissing = missingIds.filter(id => !matchData[id]);
      if (stillMissing.length > 0) {
        const API_KEY = Deno.env.get('API_FUTEBOL_KEY');
        if (API_KEY) {
          // Batch: fetch up to 20 fixtures in one API call using ids parameter
          const batchSize = 20;
          for (let i = 0; i < stillMissing.length; i += batchSize) {
            const batch = stillMissing.slice(i, i + batchSize);
            const idsParam = batch.join('-');
            try {
              const resp = await fetch(`https://v3.football.api-sports.io/fixtures?ids=${idsParam}`, {
                headers: { 'x-apisports-key': API_KEY },
              });
              const json = await resp.json();
              for (const fixture of (json.response || [])) {
                const fId = String(fixture.fixture?.id);
                matchData[fId] = {
                  homeGoals: fixture.goals?.home ?? 0,
                  awayGoals: fixture.goals?.away ?? 0,
                  corners: (fixture.statistics || []).reduce((sum: number, team: any) => {
                    const cs = team.statistics?.find((s: any) => s.type === 'Corner Kicks');
                    return sum + (cs?.value ?? 0);
                  }, 0),
                  finished: ['FT', 'AET', 'PEN'].includes(fixture.fixture?.status?.short),
                  status: fixture.fixture?.status?.short,
                };
              }
            } catch (e) {
              console.error(`Batch fetch failed for ids ${idsParam}:`, e);
            }
          }
        }
      }
    }

    console.log(`[CHECK-RESULTS] ${Object.keys(matchData).length}/${matchIds.length} matches resolved (${liveMatches.length} from cache)`);

    let processed = 0;
    const results: Array<{ id: string; status: string }> = [];

    for (const signal of pendingSignals) {
      const data = matchData[signal.match_id];
      if (!data) continue;

      let newStatus = signal.status;
      if (signal.status === 'pendente') {
        const signalAge = Date.now() - new Date(signal.created_at).getTime();
        const timedOut = signalAge > 3 * 60 * 60 * 1000;

        newStatus = checkMarketResult(
          signal.market,
          data.homeGoals,
          data.awayGoals,
          data.corners,
          data.finished || timedOut
        );

        if (newStatus === 'pendente') continue;
      }

      // Edit Telegram message
      let telegramEdited = false;
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

          const tgResp = await editTelegramMessage(CHAT_ID, signal.telegram_message_id, updatedText, {
            botToken: TELEGRAM_BOT_TOKEN,
            tag: 'CHECK-RESULTS',
          });
          const tgResult = tgResp.data ?? {};
          telegramEdited = tgResp.ok;
          if (!telegramEdited) {
            if (tgResult.error_code === 429) {
              console.error(`Rate limited, stopping. Retry after ${tgResult.parameters?.retry_after}s`);
              await sb.from('telegram_signals').update({ status: newStatus, telegram_edited: false }).eq('id', signal.id);
              break;
            }
            console.error(`Telegram edit failed for signal ${signal.id}:`, JSON.stringify(tgResult));
          }
        } catch (e) {
          console.error(`Failed to edit Telegram message for signal ${signal.id}:`, e);
        }
        await new Promise(r => setTimeout(r, 1500));
      }

      const { error: updateErr } = await sb
        .from('telegram_signals')
        .update({ status: newStatus, telegram_edited: telegramEdited })
        .eq('id', signal.id);

      if (updateErr) {
        console.error(`Failed to update signal ${signal.id}:`, updateErr);
        continue;
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
