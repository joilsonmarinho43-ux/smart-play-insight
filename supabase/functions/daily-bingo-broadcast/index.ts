// ═══════════════════════════════════════════════════════════════
// daily-bingo-broadcast — envia o Bingo Scanner PRO do dia
// para o grupo do Telegram (1x por dia via pg_cron).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegramMessage, escapeHtml, enqueueTelegramOutbox } from '../_shared/telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Poisson helpers
function fact(n: number) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function pProb(l: number, k: number) { return (Math.exp(-l) * Math.pow(l, k)) / fact(k); }
function pOver(l: number, k: number) { let c = 0; for (let i = 0; i < k; i++) c += pProb(l, i); return Math.max(0, Math.min(1, 1 - c)); }

const UNSTABLE = ['friendly','friendlies','u17','u19','u20','u21','u23','sub-','reserve','reserva','youth','juvenil','amateur','amador','women','feminino'];

interface Pick {
  match: string;
  league: string;
  time: string;
  market: string;
  probability: number;
}

function analyzeMatch(m: any): Pick[] {
  const league = (m.league?.name || m.league || '').toString();
  if (UNSTABLE.some(t => league.toLowerCase().includes(t))) return [];

  const hStats = m.homeStats || {};
  const aStats = m.awayStats || {};
  const hGames = hStats.gamesCount || 0;
  const aGames = aStats.gamesCount || 0;
  if (hGames < 3 || aGames < 3) return [];

  const leagueAvg = hStats.leagueAvg || aStats.leagueAvg || 1.30;
  const k = 3;
  const hGF = hStats.goalsFor || 0;
  const hGA = hStats.goalsAgainst || 0;
  const aGF = aStats.goalsFor || 0;
  const aGA = aStats.goalsAgainst || 0;

  const adjHGF = (hGames * hGF + k * leagueAvg) / (hGames + k);
  const adjAGF = (aGames * aGF + k * leagueAvg) / (aGames + k);
  const adjHGA = (hGames * hGA + k * leagueAvg) / (hGames + k);
  const adjAGA = (aGames * aGA + k * leagueAvg) / (aGames + k);

  const homeLambda = (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg;
  const awayLambda = (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg;
  const total = homeLambda + awayLambda;

  const probOver15 = Math.round(pOver(total, 2) * 100);
  const probOver25 = Math.round(pOver(total, 3) * 100);
  const probBtts = Math.round((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)) * 100);

  const homeName = m.teams?.home?.name || m.homeTeam || 'Casa';
  const awayName = m.teams?.away?.name || m.awayTeam || 'Fora';
  const matchName = `${homeName} vs ${awayName}`;
  const time = m.fixture?.date
    ? new Date(m.fixture.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : '';

  const picks: Pick[] = [];
  if (probOver15 >= 78) picks.push({ match: matchName, league, time, market: '⚽ Over 1.5 Gols', probability: probOver15 });
  if (probOver25 >= 75) picks.push({ match: matchName, league, time, market: '🔥 Over 2.5 Gols', probability: probOver25 });
  if (probBtts >= 72) picks.push({ match: matchName, league, time, market: '🤝 Ambas Marcam', probability: probBtts });
  return picks;
}

function buildMessage(picks: Pick[], dateStr: string): string {
  const header = [
    `🎯 <b>BINGO SCANNER PRO</b>`,
    `📅 <i>${dateStr}</i>`,
    ``,
    `Top entradas do dia (modelo Poisson + xG):`,
    ``,
  ];
  const body = picks.slice(0, 12).map((p, i) => {
    return [
      `${i + 1}. <b>${escapeHtml(p.match)}</b>`,
      `   ⏰ ${escapeHtml(p.time)} • ${escapeHtml(p.league)}`,
      `   ${p.market} — <b>${p.probability}%</b>`,
    ].join('\n');
  });
  const footer = [
    ``,
    `🤖 <i>Analista Joilson — Modelo Híbrido Ponderado</i>`,
    `📲 Acesse a plataforma para análise completa.`,
  ];
  return [...header, ...body, ...footer].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey) throw new Error('env missing');

    const sb = createClient(supabaseUrl, supabaseKey);

    // hoje em horário de São Paulo
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const date = today.toISOString().split('T')[0];

    const fbRes = await fetch(`${supabaseUrl}/functions/v1/football-api`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    const fb = await fbRes.json();
    const matches: any[] = Array.isArray(fb?.matches) ? fb.matches : [];

    console.log(`[BINGO-BROADCAST] ${matches.length} jogos para ${date}`);

    const allPicks: Pick[] = [];
    for (const m of matches) allPicks.push(...analyzeMatch(m));

    // ordenar por probabilidade e pegar top
    allPicks.sort((a, b) => b.probability - a.probability);

    if (allPicks.length === 0) {
      console.log('[BINGO-BROADCAST] Nenhum pick qualificado hoje');
      return new Response(JSON.stringify({ ok: true, picks: 0, message: 'no qualified picks' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dateLabel = today.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' });
    const text = buildMessage(allPicks, dateLabel);

    const r = await sendTelegramMessage(TELEGRAM_CHAT_ID, text, { tag: 'BINGO-BROADCAST' });

    if (!r.ok) {
      await enqueueTelegramOutbox(sb, {
        chat_id: TELEGRAM_CHAT_ID, text, source: 'daily-bingo-broadcast',
        last_error: r.error || JSON.stringify(r.data || {}),
      });
    }

    console.log(`[BINGO-BROADCAST] picks=${allPicks.length} sent=${r.ok}`);

    return new Response(JSON.stringify({ ok: r.ok, picks: allPicks.length, sent: r.ok }), {
      status: r.ok ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[BINGO-BROADCAST] error:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
