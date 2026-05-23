// ═══════════════════════════════════════════════════════════════
// daily-bingo-broadcast — ENTRADAS PREMIUM PRÉ-JOGO (manhã)
// Poisson + xG, ranking por premiumScore, EV+, aprendizado por histórico,
// dedup 24h, filtros de qualidade reais e logs profissionais.
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegramMessage, escapeHtml, enqueueTelegramOutbox } from '../_shared/telegram.ts';
import { brTodayDate, brTime, brDate, brHour, APP_TZ } from '../_shared/timezone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = Deno.env.get('APP_PUBLIC_URL') || 'https://analista.funecob.com.br';
const SEP = '━━━━━━━━━━━━━━━━━━━';

// ── Poisson helpers (com guards numéricos)
function fact(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function pProb(l: number, k: number): number {
  if (!Number.isFinite(l) || l <= 0) return 0;
  const v = (Math.exp(-l) * Math.pow(l, k)) / fact(k);
  return Number.isFinite(v) ? v : 0;
}
function pOver(l: number, k: number): number {
  if (!Number.isFinite(l) || l <= 0) return 0;
  let c = 0;
  for (let i = 0; i < k; i++) c += pProb(l, i);
  return Math.max(0, Math.min(1, 1 - c));
}

const UNSTABLE = [
  'friendly','friendlies','amistos','amistoso',
  'u15','u16','u17','u18','u19','u20','u21','u23',
  'sub-15','sub-16','sub-17','sub-18','sub-19','sub-20','sub-21','sub-23',
  'reserve','reserva','youth','juvenil','amateur','amador',
  'pre-season','pré-temporada','pre season',
  'women','feminino','féminin','femenino','frauen',
  'regional','third division','terceira',
];

function probEmoji(p: number): string | null {
  if (p >= 90) return '🔒';
  if (p >= 80) return '🔥';
  if (p >= 70) return '🤝';
  return null;
}

function impliedProb(odd: number): number {
  return odd > 1 ? Math.round((1 / odd) * 100) : 0;
}

/** odd justa estimada a partir da probabilidade do modelo + margem 8% do book */
function fairOdd(probPct: number): number {
  if (probPct <= 0) return 0;
  const fair = 100 / probPct;
  const withMargin = fair * 0.92;
  if (!Number.isFinite(withMargin)) return 0;
  return Math.max(1.05, +withMargin.toFixed(2));
}

const CTAS = [
  'Entre agora antes do mercado ajustar',
  'Odds em movimento, aproveite o timing',
  'Entrada liberada com valor identificado',
  'Sinal ativo, gestão recomendada',
  'Janela de oportunidade aberta',
];

const CENARIOS = {
  ofensivo: 'Equipes com tendência ofensiva consistente, cenário propício a múltiplos gols.',
  btts: 'Confronto equilibrado com alto poder de finalização de ambos os lados.',
  favorito: 'Favoritismo técnico evidente, leveza de produção contra defesa frágil.',
  intenso: 'Cenário propício para intensidade ofensiva e bom volume de finalizações.',
  cauteloso: 'Jogo tático com leve vantagem para o mandante, gestão recomendada.',
};

interface MarketRow {
  name: string;
  type: string;
  prob: number;
}

interface MatchAnalysis {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  date: string;
  premiumScore: number;
  cenario: string;
  over15: number; over25: number; btts: number;
  winnerName: string; winnerProb: number;
  doubleLabel: string; doubleProb: number;
  handicapLine: string; handicapProb: number;
  cornersLine: number; cornersProb: number;
  cardsLine: number; cardsProb: number;
  htGoal: number; ftGoal: number;
  formWeight: number;
}

function safeNum(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** Ajustes de aprendizado por histórico de market_type (ROI nos últimos 30 dias). */
type LearnAdjust = Record<string, number>; // market_type → multiplicador 0.85..1.15

async function fetchLearningAdjustments(sb: any): Promise<LearnAdjust> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('telegram_signals')
    .select('market_type, status, roi')
    .gte('created_at', since)
    .in('status', ['green', 'loss']);
  if (error || !data) return {};
  const agg: Record<string, { n: number; r: number }> = {};
  for (const s of data) {
    const k = s.market_type || 'outros';
    const a = agg[k] ||= { n: 0, r: 0 };
    a.n++;
    a.r += Number(s.roi) || 0;
  }
  const adj: LearnAdjust = {};
  for (const [k, v] of Object.entries(agg)) {
    if (v.n < 8) { adj[k] = 1; continue; }
    const roiAvg = v.r / v.n; // ex: -0.2..+0.3
    // mapeia roiAvg para multiplicador 0.85..1.15
    const mult = Math.max(0.85, Math.min(1.15, 1 + roiAvg * 0.5));
    adj[k] = +mult.toFixed(3);
  }
  return adj;
}

function analyzeMatch(m: any): MatchAnalysis | null {
  const league = (m.league?.name || m.league || '').toString();
  if (!league) return null;
  if (UNSTABLE.some(t => league.toLowerCase().includes(t))) return null;

  const hStats = m.homeStats || {};
  const aStats = m.awayStats || {};
  const hGames = safeNum(hStats.gamesCount);
  const aGames = safeNum(aStats.gamesCount);
  if (hGames < 3 || aGames < 3) return null;

  const leagueAvg = safeNum(hStats.leagueAvg || aStats.leagueAvg, 1.30);
  const k = 3;
  const adj = (g: number, v: number) => {
    const den = g + k;
    if (den <= 0) return leagueAvg;
    return (g * v + k * leagueAvg) / den;
  };

  const adjHGF = adj(hGames, safeNum(hStats.goalsFor));
  const adjAGF = adj(aGames, safeNum(aStats.goalsFor));
  const adjHGA = adj(hGames, safeNum(hStats.goalsAgainst));
  const adjAGA = adj(aGames, safeNum(aStats.goalsAgainst));

  const safeLA = leagueAvg > 0 ? leagueAvg : 1.30;
  const homeLambda = (adjHGF / safeLA) * (adjAGA / safeLA) * safeLA;
  const awayLambda = (adjAGF / safeLA) * (adjHGA / safeLA) * safeLA;
  if (!Number.isFinite(homeLambda) || !Number.isFinite(awayLambda)) return null;
  const total = homeLambda + awayLambda;
  if (total <= 0.5) return null;

  const over15 = Math.round(pOver(total, 2) * 100);
  const over25 = Math.round(pOver(total, 3) * 100);
  const btts = Math.round((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)) * 100);

  let pHome = 0, pDraw = 0, pAway = 0;
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const p = pProb(homeLambda, i) * pProb(awayLambda, j);
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
    }
  }

  const homeName = m.teams?.home?.name || m.homeTeam || 'Casa';
  const awayName = m.teams?.away?.name || m.awayTeam || 'Fora';
  let winnerName = homeName, winnerProb = Math.round(pHome * 100);
  if (pAway > pHome && pAway > pDraw) { winnerName = awayName; winnerProb = Math.round(pAway * 100); }

  let doubleLabel = `${homeName} ou Empate`;
  let doubleProb = Math.round((pHome + pDraw) * 100);
  if (pAway > pHome) { doubleLabel = `${awayName} ou Empate`; doubleProb = Math.round((pAway + pDraw) * 100); }

  const handicapLine = pHome >= pAway ? `${homeName} -0.5` : `${awayName} -0.5`;
  const handicapProb = winnerProb;

  const cornersAvg = safeNum(hStats.cornersFor, 5) + safeNum(aStats.cornersFor, 5);
  const cornersLine = 8.5;
  const cornersLambda = Math.max(6, cornersAvg);
  const cornersProb = Math.round(pOver(cornersLambda, 9) * 100);

  const cardsAvg = safeNum(hStats.cardsFor, 2) + safeNum(aStats.cardsFor, 2);
  const cardsLine = 3.5;
  const cardsLambda = Math.max(2.5, cardsAvg);
  const cardsProb = Math.round(pOver(cardsLambda, 4) * 100);

  const htLambda = total * 0.45;
  const ftLambda = total * 0.55;
  const htGoal = Math.round((1 - Math.exp(-htLambda)) * 100);
  const ftGoal = Math.round((1 - Math.exp(-ftLambda)) * 100);

  const hPpg = safeNum(hStats.ppg, 1.3);
  const aPpg = safeNum(aStats.ppg, 1.3);
  const formWeight = Math.round(((hPpg + aPpg) / 6) * 100);

  const time = m.fixture?.date ? brTime(m.fixture.date) : '';
  const date = m.fixture?.date ? brDate(m.fixture.date) : '';

  // ── FILTROS DE QUALIDADE REAIS
  const topProb = Math.max(over15, over25, btts, winnerProb, doubleProb, cornersProb, htGoal, ftGoal);
  if (topProb < 70) return null;
  // baixa média ofensiva → não interessa pré-jogo
  if (total < 2.0 && over15 < 75) return null;
  // over 2.5 muito baixo + sem dominância clara → bloqueia
  if (over25 < 55 && winnerProb < 60 && btts < 70) return null;

  const premiumScore =
    (over15 * 0.20) + (over25 * 0.20) + (btts * 0.15) +
    (winnerProb * 0.15) + (cornersProb * 0.10) +
    (htGoal * 0.10) + (formWeight * 0.10);

  let cenario = CENARIOS.intenso;
  if (over25 >= 80 && btts >= 70) cenario = CENARIOS.ofensivo;
  else if (btts >= 75) cenario = CENARIOS.btts;
  else if (winnerProb >= 65) cenario = CENARIOS.favorito;
  else if (over25 < 60) cenario = CENARIOS.cauteloso;

  return {
    matchId: String(m.fixture?.id || m.id || `${homeName}-${awayName}`),
    homeTeam: homeName, awayTeam: awayName, league, time, date,
    premiumScore, cenario,
    over15, over25, btts, winnerName, winnerProb,
    doubleLabel, doubleProb, handicapLine, handicapProb,
    cornersLine, cornersProb, cardsLine, cardsProb,
    htGoal, ftGoal, formWeight,
    _kickoffMs: m.fixture?.date ? new Date(m.fixture.date).getTime() : undefined,
  } as MatchAnalysis & { _kickoffMs?: number };
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
  lines.push(escapeHtml(a.cenario));
  lines.push('');
  lines.push(SEP);
  lines.push('');

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

  const all = [
    { name: 'Over 1.5 Gols', p: a.over15 },
    { name: 'Over 2.5 Gols', p: a.over25 },
    { name: 'Ambas Marcam', p: a.btts },
    { name: `Vitória ${a.winnerName}`, p: a.winnerProb },
    { name: `Chance Dupla (${a.doubleLabel})`, p: a.doubleProb },
  ].filter(x => x.p >= 70).sort((x, y) => y.p - x.p);
  if (all.length > 0) {
    const seguro = all[0];
    const agressivo = all[all.length - 1];
    lines.push('⚠️ <b>Gestão de Risco:</b>');
    lines.push(`Entrada segura: ${escapeHtml(seguro.name)} (${seguro.p}%)`);
    lines.push(`Entrada agressiva: ${escapeHtml(agressivo.name)} (${agressivo.p}%)`);
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
  lines.push('🤖 <b>Nexus 33</b>');
  lines.push('📌 Modelo Híbrido Ponderado');
  return lines.join('\n');
}

/** Mercados que serão persistidos (com filtro EV+ aplicado depois). */
function buildPersistableMarkets(a: MatchAnalysis): MarketRow[] {
  const m: MarketRow[] = [
    { name: 'Over 1.5 Gols', type: 'over_goals', prob: a.over15 },
    { name: 'Over 2.5 Gols', type: 'over_goals', prob: a.over25 },
    { name: 'Ambas Marcam', type: 'btts', prob: a.btts },
    { name: `Over ${a.cornersLine} Escanteios`, type: 'corners', prob: a.cornersProb },
    { name: `Over ${a.cardsLine} Cartões`, type: 'cards', prob: a.cardsProb },
    { name: 'Gol no 1º Tempo', type: 'ht_goal', prob: a.htGoal },
    { name: 'Gol no 2º Tempo', type: 'ft_goal', prob: a.ftGoal },
  ];
  return m.filter(x => x.prob >= 70);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey) throw new Error('env missing');

    // Flag de teste manual: bypassa EV+/dedup. NÃO afeta cron padrão.
    let forceSend = false;
    try {
      if (req.method === 'POST') {
        const body = await req.clone().json().catch(() => ({}));
        forceSend = body?.force_send === true;
      }
    } catch { /* ignore */ }
    if (forceSend) console.log('[BINGO] ⚠️ force_send=true (modo teste manual)');

    const sb = createClient(supabaseUrl, supabaseKey);

    const date = brTodayDate();
    // Busca janela de até 4 dias (hoje + 3) — garante que dias sem jogos
    // das ligas-elite ainda encontrem picks no horizonte próximo.
    const HORIZON_DAYS = 4;
    const dates: string[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const d = new Date(date + 'T00:00:00-03:00');
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    console.log(`[TIMEZONE] tz=${APP_TZ} window=${dates.join(',')}`);

    // ── busca jogos em paralelo + aprendizado
    const fbHeaders = { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' };
    const dayFetches = dates.map(d =>
      fetch(`${supabaseUrl}/functions/v1/football-api`, {
        method: 'POST', headers: fbHeaders, body: JSON.stringify({ date: d }),
      }).then(r => r.json()).catch(() => ({ matches: [] }))
    );
    const [learn, ...dayResults] = await Promise.all([fetchLearningAdjustments(sb), ...dayFetches]);
    const matches: any[] = dayResults.flatMap((r: any) => Array.isArray(r?.matches) ? r.matches : []);
    const perDayCount = dayResults.map((r: any, i: number) => `${dates[i]}=${Array.isArray(r?.matches) ? r.matches.length : 0}`).join(' ');

    console.log(`[BINGO] ${perDayCount} total=${matches.length} learn_keys=${Object.keys(learn).length}`);

    const analyses: MatchAnalysis[] = [];
    for (const m of matches) {
      try {
        const a = analyzeMatch(m);
        if (a) analyses.push(a);
      } catch (e) {
        console.warn('[BINGO] analyze error:', e instanceof Error ? e.message : e);
      }
    }

    // Considera todos os jogos do dia que ainda não começaram (kickoff > agora BRT).
    // Antes filtrava só hora < 12, o que descartava quase todos os jogos.
    const nowMs = Date.now();
    const upcoming = analyses.filter(a => {
      const ko = (a as any)._kickoffMs as number | undefined;
      if (typeof ko === 'number') return ko > nowMs;
      // fallback: usa hora BRT >= hora atual BRT
      const [hStr, mStr] = (a.time || '99:99').split(':');
      const h = Number(hStr), mn = Number(mStr);
      if (!Number.isFinite(h)) return false;
      const nowBrtH = Number(brHour(new Date().toISOString()));
      return h > nowBrtH || (h === nowBrtH && Number.isFinite(mn) && mn >= 0);
    });

    upcoming.sort((a, b) => b.premiumScore - a.premiumScore);
    const top = upcoming.slice(0, 8);
    console.log(`[BINGO] qualified=${analyses.length} upcoming=${upcoming.length} top=${top.length}`);

    if (top.length === 0) {
      return new Response(JSON.stringify({ ok: true, picks: 0, message: 'no qualified picks' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── DEDUP: jogos enviados nas últimas 24h
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ids = top.map(t => t.matchId);
    const { data: dupRows } = await sb
      .from('telegram_signals')
      .select('match_id')
      .in('match_id', ids)
      .eq('reason', 'daily-bingo-premium')
      .gte('created_at', since24h);
    const dupSet = new Set((dupRows || []).map(r => r.match_id));

    let sent = 0, signalsSaved = 0, skippedDup = 0, skippedEv = 0;

    for (const a of top) {
      if (dupSet.has(a.matchId) && !forceSend) {
        skippedDup++;
        console.log(`[BINGO] skip dup match=${a.matchId}`);
        continue;
      }

      // ── Filtra mercados por EV+ e aplica aprendizado
      const allMarkets = buildPersistableMarkets(a);
      const evMarketsRaw = allMarkets
        .map(mk => {
          const mult = learn[mk.type] ?? 1;
          const adjustedProb = Math.max(0, Math.min(100, mk.prob * mult));
          const odd = fairOdd(adjustedProb);
          const implied = impliedProb(odd);
          const ev = +(adjustedProb - implied).toFixed(2);
          return { ...mk, odd, implied, ev, adjustedProb };
        });
      const evMarkets = forceSend
        ? evMarketsRaw.filter(mk => mk.odd >= 1.10)
        : evMarketsRaw.filter(mk => mk.ev > 0 && mk.odd >= 1.10);

      if (evMarkets.length === 0) {
        skippedEv++;
        console.log(`[BINGO] skip EV-neg match=${a.matchId}`);
        continue;
      }

      const text = buildPremiumMessage(a);
      const r = await sendTelegramMessage(TELEGRAM_CHAT_ID, text, { tag: 'BINGO-PREMIUM' });

      if (r.ok) {
        sent++;
        const msgId = r.data?.result?.message_id ?? null;

        const rows = evMarkets.map(mk => ({
          match_id: a.matchId,
          match_name: `${a.homeTeam} vs ${a.awayTeam}`,
          market: mk.name,
          market_type: mk.type,
          minute: 0,
          confidence: Math.round(mk.adjustedProb),
          score: '0-0',
          reason: 'daily-bingo-premium',
          sensitivity: 'PRE',
          success: null,
          status: 'pendente',
          telegram_message_id: msgId,
          odd: mk.odd,
          implied_probability: mk.implied,
          expected_value: mk.ev,
          model_probability: mk.prob,
          premium_score: a.premiumScore,
        }));
        const { error: insErr } = await sb.from('telegram_signals').insert(rows);
        if (insErr) {
          console.error('[BINGO] insert signals failed:', insErr.message);
        } else {
          signalsSaved += rows.length;
        }
      } else {
        console.error('[TELEGRAM] fail:', r.status, r.error || JSON.stringify(r.data || {}));
        await enqueueTelegramOutbox(sb, {
          chat_id: TELEGRAM_CHAT_ID, text, source: 'daily-bingo-broadcast',
          last_error: r.error || JSON.stringify(r.data || {}),
        });
      }
      await new Promise(res => setTimeout(res, 350));
    }

    const elapsed = Date.now() - t0;
    console.log(`[BINGO] picks=${top.length} sent=${sent} signals=${signalsSaved} dup=${skippedDup} ev_neg=${skippedEv} elapsed=${elapsed}ms`);

    return new Response(JSON.stringify({
      ok: true,
      picks: top.length,
      sent,
      signals: signalsSaved,
      skipped_duplicate: skippedDup,
      skipped_ev_negative: skippedEv,
      elapsed_ms: elapsed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[BINGO] error:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
