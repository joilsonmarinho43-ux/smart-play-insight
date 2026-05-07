// ═══════════════════════════════════════════════════════════════
// daily-bingo-broadcast — envia ENTRADAS PREMIUM do dia
// para o grupo do Telegram (1x por dia via pg_cron).
// Formato: mensagem premium por jogo (template Analista Joilson).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegramMessage, escapeHtml, enqueueTelegramOutbox } from '../_shared/telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = Deno.env.get('APP_PUBLIC_URL') || 'https://analista.funecob.com.br';

// ── Poisson helpers
function fact(n: number) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function pProb(l: number, k: number) { return (Math.exp(-l) * Math.pow(l, k)) / fact(k); }
function pOver(l: number, k: number) { let c = 0; for (let i = 0; i < k; i++) c += pProb(l, i); return Math.max(0, Math.min(1, 1 - c)); }

const UNSTABLE = ['friendly','friendlies','u17','u19','u20','u21','u23','sub-','reserve','reserva','youth','juvenil','amateur','amador','women','feminino'];

const SEP = '━━━━━━━━━━━━━━━━━━━';

function probEmoji(p: number): string | null {
  if (p >= 90) return '🔒';
  if (p >= 80) return '🔥';
  if (p >= 70) return '🤝';
  return null;
}

const CTAS = [
  'Entre agora antes do mercado ajustar',
  'Odds em movimento, aproveite o timing',
  'Entrada liberada com valor identificado',
  'Sinal ativo, gestão recomendada',
  'Janela de oportunidade aberta',
];

interface MatchAnalysis {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  date: string;
  topProb: number;
  // markets
  over15: number;
  over25: number;
  btts: number;
  winnerName: string;
  winnerProb: number;
  doubleLabel: string;
  doubleProb: number;
  handicapLine: string;
  handicapProb: number;
  cornersLine: number;
  cornersProb: number;
  cardsLine: number;
  cardsProb: number;
  htGoal: number;
  ftGoal: number;
}

function analyzeMatch(m: any): MatchAnalysis | null {
  const league = (m.league?.name || m.league || '').toString();
  if (UNSTABLE.some(t => league.toLowerCase().includes(t))) return null;

  const hStats = m.homeStats || {};
  const aStats = m.awayStats || {};
  const hGames = hStats.gamesCount || 0;
  const aGames = aStats.gamesCount || 0;
  if (hGames < 3 || aGames < 3) return null;

  const leagueAvg = hStats.leagueAvg || aStats.leagueAvg || 1.30;
  const k = 3;
  const adj = (g: number, v: number) => (g * v + k * leagueAvg) / (g + k);
  const adjHGF = adj(hGames, hStats.goalsFor || 0);
  const adjAGF = adj(aGames, aStats.goalsFor || 0);
  const adjHGA = adj(hGames, hStats.goalsAgainst || 0);
  const adjAGA = adj(aGames, aStats.goalsAgainst || 0);

  const homeLambda = (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg;
  const awayLambda = (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg;
  const total = homeLambda + awayLambda;

  // Gols
  const over15 = Math.round(pOver(total, 2) * 100);
  const over25 = Math.round(pOver(total, 3) * 100);
  const btts = Math.round((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)) * 100);

  // 1x2 simples via Poisson grid 0..6
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const p = pProb(homeLambda, i) * pProb(awayLambda, j);
    if (i > j) pHome += p; else if (i === j) pDraw += p; else pAway += p;
  }
  const homeName = m.teams?.home?.name || m.homeTeam || 'Casa';
  const awayName = m.teams?.away?.name || m.awayTeam || 'Fora';
  let winnerName = homeName, winnerProb = Math.round(pHome * 100);
  if (pAway > pHome && pAway > pDraw) { winnerName = awayName; winnerProb = Math.round(pAway * 100); }

  // Chance dupla — favorito + empate
  let doubleLabel = `${homeName} ou Empate`, doubleProb = Math.round((pHome + pDraw) * 100);
  if (pAway > pHome) { doubleLabel = `${awayName} ou Empate`; doubleProb = Math.round((pAway + pDraw) * 100); }

  // Handicap -0.5 favorito = vitória
  const handicapLine = pHome >= pAway ? `${homeName} -0.5` : `${awayName} -0.5`;
  const handicapProb = winnerProb;

  // Escanteios — média estimada
  const cornersAvg = ((hStats.cornersFor || 5) + (aStats.cornersFor || 5));
  const cornersLine = 8.5;
  const cornersLambda = Math.max(6, cornersAvg);
  const cornersProb = Math.round(pOver(cornersLambda, 9) * 100);

  // Cartões — média estimada
  const cardsAvg = ((hStats.cardsFor || 2) + (aStats.cardsFor || 2));
  const cardsLine = 3.5;
  const cardsLambda = Math.max(2.5, cardsAvg);
  const cardsProb = Math.round(pOver(cardsLambda, 4) * 100);

  // HT / FT goal (≥1 gol em cada tempo)
  const htLambda = total * 0.45;
  const ftLambda = total * 0.55;
  const htGoal = Math.round((1 - Math.exp(-htLambda)) * 100);
  const ftGoal = Math.round((1 - Math.exp(-ftLambda)) * 100);

  const time = m.fixture?.date
    ? new Date(m.fixture.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : '';
  const date = m.fixture?.date
    ? new Date(m.fixture.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
    : '';

  const topProb = Math.max(over15, over25, btts, winnerProb, doubleProb, handicapProb, cornersProb, cardsProb, htGoal, ftGoal);

  // só joga se tem ao menos um mercado >=70
  if (topProb < 70) return null;

  return {
    matchId: String(m.fixture?.id || m.id || `${homeName}-${awayName}`),
    homeTeam: homeName, awayTeam: awayName, league, time, date, topProb,
    over15, over25, btts, winnerName, winnerProb,
    doubleLabel, doubleProb, handicapLine, handicapProb,
    cornersLine, cornersProb, cardsLine, cardsProb, htGoal, ftGoal,
  };
}

function buildPremiumMessage(a: MatchAnalysis): string {
  const lines: string[] = [];
  lines.push('🚨 <b>ENTRADA PREMIUM LIBERADA</b> 🚨');
  lines.push('');
  lines.push(`📅 ${escapeHtml(a.date)}`);
  lines.push(`🏆 ${escapeHtml(a.league)}`);
  lines.push('');
  lines.push(SEP);
  lines.push('');
  lines.push(`⚔️ <b>${escapeHtml(a.homeTeam)} vs ${escapeHtml(a.awayTeam)}</b>`);
  lines.push(`⏰ ${escapeHtml(a.time)}`);
  lines.push('');
  lines.push('📊 <b>Cenário do Jogo:</b>');
  const cenario = a.over25 >= 75
    ? 'Confronto com forte tendência ofensiva e bom volume de gols esperado.'
    : a.btts >= 70
      ? 'Equilíbrio ofensivo, ambos times com poder de finalização.'
      : `Favoritismo claro do ${a.winnerName}, com superioridade técnica.`;
  lines.push(cenario);
  lines.push('');
  lines.push(SEP);
  lines.push('');

  // MERCADOS PRINCIPAIS — só >=70
  const principais: string[] = [];
  if (probEmoji(a.over15)) principais.push(`${probEmoji(a.over15)} Over 1.5 Gols → <b>${a.over15}%</b>`);
  if (probEmoji(a.over25)) principais.push(`${probEmoji(a.over25)} Over 2.5 Gols → <b>${a.over25}%</b>`);
  if (probEmoji(a.btts)) principais.push(`${probEmoji(a.btts)} Ambas Marcam → <b>${a.btts}%</b>`);

  if (principais.length > 0) {
    lines.push('🎯 <b>MERCADOS PRINCIPAIS:</b>');
    lines.push('');
    lines.push(...principais);
    lines.push('');
    lines.push(SEP);
    lines.push('');
  }

  // MERCADOS AVANÇADOS — TOP 5
  const avancados: { label: string; prob: number }[] = [];
  if (probEmoji(a.winnerProb)) avancados.push({ label: `${probEmoji(a.winnerProb)} Vitória ${escapeHtml(a.winnerName)}`, prob: a.winnerProb });
  if (probEmoji(a.doubleProb)) avancados.push({ label: `${probEmoji(a.doubleProb)} Chance Dupla (${escapeHtml(a.doubleLabel)})`, prob: a.doubleProb });
  if (probEmoji(a.handicapProb)) avancados.push({ label: `${probEmoji(a.handicapProb)} Handicap ${escapeHtml(a.handicapLine)}`, prob: a.handicapProb });
  if (probEmoji(a.cornersProb)) avancados.push({ label: `${probEmoji(a.cornersProb)} Over ${a.cornersLine} Escanteios`, prob: a.cornersProb });
  if (probEmoji(a.cardsProb)) avancados.push({ label: `${probEmoji(a.cardsProb)} Over ${a.cardsLine} Cartões`, prob: a.cardsProb });
  if (probEmoji(a.htGoal)) avancados.push({ label: `${probEmoji(a.htGoal)} Gol no 1º Tempo`, prob: a.htGoal });
  if (probEmoji(a.ftGoal)) avancados.push({ label: `${probEmoji(a.ftGoal)} Gol no 2º Tempo`, prob: a.ftGoal });

  const top5 = avancados.sort((x, y) => y.prob - x.prob).slice(0, 5);
  if (top5.length > 0) {
    lines.push('📈 <b>MERCADOS AVANÇADOS:</b>');
    lines.push('');
    for (const it of top5) lines.push(`${it.label} → <b>${it.prob}%</b>`);
    lines.push('');
    lines.push(SEP);
    lines.push('');
  }

  // Gestão de risco
  const all = [
    { name: 'Over 1.5 Gols', p: a.over15 },
    { name: 'Over 2.5 Gols', p: a.over25 },
    { name: 'Ambas Marcam', p: a.btts },
    { name: `Vitória ${a.winnerName}`, p: a.winnerProb },
    { name: `Chance Dupla (${a.doubleLabel})`, p: a.doubleProb },
  ].filter(x => x.p >= 70).sort((x, y) => y.p - x.p);

  if (all.length > 0) {
    const seguro = all[0];
    const agressivo = all.slice().sort((x, y) => x.p - y.p)[0];
    lines.push('⚠️ <b>Gestão de Risco:</b>');
    lines.push(`Entrada segura: ${escapeHtml(seguro.name)}`);
    lines.push(`Entrada agressiva: ${escapeHtml(agressivo.name)}`);
    lines.push('');
    lines.push(SEP);
    lines.push('');
  }

  const cta = CTAS[Math.floor(Math.random() * CTAS.length)];
  lines.push('🚀 <b>Ação Rápida:</b>');
  lines.push(cta);
  lines.push('');
  lines.push(`🔗 ${APP_URL}/match/${a.matchId}`);
  lines.push('');
  lines.push('🌐 Ou acesse o app:');
  lines.push(APP_URL);
  lines.push('');
  lines.push(SEP);
  lines.push('');
  lines.push('🤖 <b>Analista Joilson</b>');
  lines.push('📌 Modelo Híbrido Ponderado');

  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey) throw new Error('env missing');

    const sb = createClient(supabaseUrl, supabaseKey);

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

    const analyses: MatchAnalysis[] = [];
    for (const m of matches) {
      const a = analyzeMatch(m);
      if (a) analyses.push(a);
    }

    analyses.sort((a, b) => b.topProb - a.topProb);
    const top = analyses.slice(0, 8); // limita a 8 entradas premium/dia

    if (top.length === 0) {
      console.log('[BINGO-BROADCAST] Nenhuma entrada qualificada hoje');
      return new Response(JSON.stringify({ ok: true, picks: 0, message: 'no qualified picks' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    for (const a of top) {
      const text = buildPremiumMessage(a);
      const r = await sendTelegramMessage(TELEGRAM_CHAT_ID, text, { tag: 'BINGO-PREMIUM' });
      if (r.ok) {
        sent++;
      } else {
        await enqueueTelegramOutbox(sb, {
          chat_id: TELEGRAM_CHAT_ID, text, source: 'daily-bingo-broadcast',
          last_error: r.error || JSON.stringify(r.data || {}),
        });
      }
      // delay leve para evitar rate limit Telegram
      await new Promise(res => setTimeout(res, 350));
    }

    console.log(`[BINGO-BROADCAST] picks=${top.length} sent=${sent}`);

    return new Response(JSON.stringify({ ok: true, picks: top.length, sent }), {
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
