// ═══════════════════════════════════════════════════════════════
// daily-correct-score-broadcast — PLACAR EXATO DO DIA (1x por dia)
// Envia UMA imagem (PNG) no Telegram com os melhores placares exatos
// do dia, calculados com Poisson bivariado + Dixon-Coles.
// Projetado para rodar via pg_cron na VPS (self-hosted).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTelegramMessage, enqueueTelegramOutbox, escapeHtml, getTelegramBotToken } from '../_shared/telegram.ts';
import { brTodayDate, brTime, brDate, APP_TZ } from '../_shared/timezone.ts';
import { buildCorrectScore } from '../_shared/correctScore.ts';
import { svgToPng, svgEscape, truncate, sendTelegramPhoto } from '../_shared/renderCard.ts';


import { corsHeaders } from '../_shared/cors.ts';
const UNSTABLE = [
  'friendly', 'friendlies', 'amistos', 'amistoso',
  'u15', 'u16', 'u17', 'u18', 'u19', 'u20', 'u21', 'u23',
  'sub-15', 'sub-16', 'sub-17', 'sub-18', 'sub-19', 'sub-20', 'sub-21', 'sub-23',
  'reserve', 'reserva', 'youth', 'juvenil', 'amateur', 'amador',
  'pre-season', 'pré-temporada', 'women', 'feminino', 'femenino', 'frauen',
];

const REASON = 'daily-correct-score';
const MAX_PICKS = 5;

interface Pick {
  matchId: string;
  home: string;
  away: string;
  league: string;
  time: string;
  date: string;
  score: string;
  scoreProb: number;      // %
  scoreOdd: number;
  combo: string[];
  comboProb: number;      // %
  comboOdd: number;
  confidence: number;
  label: string;
  lambdas: string;
  sample: string;
}

/** Jogo elegível: liga estável e ainda não começou. */
function isEligible(m: any): boolean {
  const league = (m.league?.name || m.league || '').toString();
  if (!league) return false;
  if (UNSTABLE.some((t) => league.toLowerCase().includes(t))) return false;
  const kickoff = m.fixture?.date ? new Date(m.fixture.date).getTime() : NaN;
  return Number.isFinite(kickoff) && kickoff > Date.now();
}

function num(v: any, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

function hasRealStats(m: any): boolean {
  const hs = m?.homeStats || {};
  const as_ = m?.awayStats || {};
  return num(hs.gamesCount) >= 3 && num(as_.gamesCount) >= 3 && num(hs.goalsFor) > 0 && num(as_.goalsFor) > 0;
}

/** Mescla a resposta do team-form no objeto de partida (espelha mergeFormIntoMatch do app). */
function mergeForm(m: any, form: any): any {
  if (!form?.ok) return m;
  const h = form.home || {}, a = form.away || {};
  const hs = m.homeStats || {}, as_ = m.awayStats || {};
  const pick = (cur: any, inc: number) => (num(inc) > 0 && num(cur) <= 0 ? inc : cur ?? inc);
  return {
    ...m,
    homeStats: {
      ...hs,
      goalsFor: pick(hs.goalsFor, h.goalsForAvg),
      goalsAgainst: pick(hs.goalsAgainst, h.goalsAgainstAvg),
      gamesCount: Math.max(num(hs.gamesCount), num(h.games)),
      recentGoalsFor: hs.recentGoalsFor?.length ? hs.recentGoalsFor : h.recentGoalsFor,
      recentGoalsAgainst: hs.recentGoalsAgainst?.length ? hs.recentGoalsAgainst : h.recentGoalsAgainst,
    },
    awayStats: {
      ...as_,
      goalsFor: pick(as_.goalsFor, a.goalsForAvg),
      goalsAgainst: pick(as_.goalsAgainst, a.goalsAgainstAvg),
      gamesCount: Math.max(num(as_.gamesCount), num(a.games)),
      recentGoalsFor: as_.recentGoalsFor?.length ? as_.recentGoalsFor : a.recentGoalsFor,
      recentGoalsAgainst: as_.recentGoalsAgainst?.length ? as_.recentGoalsAgainst : a.recentGoalsAgainst,
    },
  };
}

/** Busca histórico real (últimos jogos) para as partidas sem estatística. */
async function enrich(matches: any[], supabaseUrl: string, key: string, limit = 40): Promise<any[]> {
  const pending = matches.filter((m) => !hasRealStats(m)).slice(0, limit);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', apikey: key };
  const map = new Map<string, any>();
  const CONC = 6;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, pending.length) }, async () => {
    while (cursor < pending.length) {
      const m = pending[cursor++];
      const home = m.teams?.home?.name || m.homeTeam;
      const away = m.teams?.away?.name || m.awayTeam;
      if (!home || !away) continue;
      try {
        const r = await fetch(`${supabaseUrl}/functions/v1/team-form`, {
          method: 'POST', headers, body: JSON.stringify({ home, away }),
        });
        const data = await r.json().catch(() => null);
        if (data?.ok) map.set(`${home}|${away}`, data);
      } catch { /* ignora falha pontual */ }
    }
  }));
  console.log(`[CS] enriquecidos=${map.size}/${pending.length}`);
  return matches.map((m) => {
    const k = `${m.teams?.home?.name || m.homeTeam}|${m.teams?.away?.name || m.awayTeam}`;
    const f = map.get(k);
    return f ? mergeForm(m, f) : m;
  });
}

function buildPick(m: any): Pick | null {

  const league = (m.league?.name || m.league || '').toString();
  if (!league) return null;
  if (UNSTABLE.some((t) => league.toLowerCase().includes(t))) return null;

  const kickoff = m.fixture?.date ? new Date(m.fixture.date).getTime() : NaN;
  if (!Number.isFinite(kickoff) || kickoff <= Date.now()) return null;

  const read = buildCorrectScore(m);
  if (!read.hasRealData) return null;
  if (read.sample.home < 3 || read.sample.away < 3) return null;
  if (read.confidence < 40) return null;

  const best = read.top[0];
  if (!best) return null;

  return {
    matchId: String(m.fixture?.id || m.id || `${m.teams?.home?.name}-${m.teams?.away?.name}`),
    home: m.teams?.home?.name || m.homeTeam || 'Casa',
    away: m.teams?.away?.name || m.awayTeam || 'Fora',
    league,
    time: m.fixture?.date ? brTime(m.fixture.date) : '',
    date: m.fixture?.date ? brDate(m.fixture.date) : '',
    score: `${best.home}-${best.away}`,
    scoreProb: +(best.prob * 100).toFixed(1),
    scoreOdd: +best.fairOdd.toFixed(2),
    combo: read.combo.map((c) => `${c.home}-${c.away}`),
    comboProb: +(read.comboProb * 100).toFixed(1),
    comboOdd: +read.comboFairOdd.toFixed(2),
    confidence: read.confidence,
    label: read.label,
    lambdas: `${read.homeLambda.toFixed(2)} x ${read.awayLambda.toFixed(2)}`,
    sample: `${read.sample.home}/${read.sample.away}`,
  };
}

function buildSvg(picks: Pick[], dateLabel: string): string {
  const W = 1080;
  const HEADER = 210;
  const ROW = 200;
  const FOOTER = 90;
  const H = HEADER + picks.length * ROW + FOOTER;

  const rows = picks.map((p, i) => {
    const y = HEADER + i * ROW;
    const conf = p.label === 'ALTA' ? '#22c55e' : p.label === 'MÉDIA' ? '#f59e0b' : '#94a3b8';
    return `
  <g>
    <rect x="40" y="${y}" width="1000" height="${ROW - 20}" rx="18" fill="#111c33" stroke="#1e2b47" stroke-width="2"/>
    <circle cx="86" cy="${y + 46}" r="22" fill="#f59e0b"/>
    <text x="86" y="${y + 54}" font-family="DejaVu Sans" font-size="24" font-weight="700" fill="#0b1220" text-anchor="middle">${i + 1}</text>
    <text x="126" y="${y + 42}" font-family="DejaVu Sans" font-size="30" font-weight="700" fill="#f8fafc">${svgEscape(truncate(`${p.home} x ${p.away}`, 40))}</text>
    <text x="126" y="${y + 76}" font-family="DejaVu Sans" font-size="21" fill="#94a3b8">${svgEscape(truncate(p.league, 40))} • ${svgEscape(p.date)} ${svgEscape(p.time)}</text>

    <rect x="126" y="${y + 96}" width="200" height="58" rx="12" fill="#1c2b4a"/>
    <text x="226" y="${y + 122}" font-family="DejaVu Sans" font-size="17" fill="#94a3b8" text-anchor="middle">PLACAR EXATO</text>
    <text x="226" y="${y + 146}" font-family="DejaVu Sans" font-size="24" font-weight="700" fill="#fbbf24" text-anchor="middle">${svgEscape(p.score)} • ${p.scoreProb}%</text>

    <rect x="342" y="${y + 96}" width="330" height="58" rx="12" fill="#1c2b4a"/>
    <text x="507" y="${y + 122}" font-family="DejaVu Sans" font-size="17" fill="#94a3b8" text-anchor="middle">COBERTURA 3 PLACARES</text>
    <text x="507" y="${y + 146}" font-family="DejaVu Sans" font-size="22" font-weight="700" fill="#f8fafc" text-anchor="middle">${svgEscape(p.combo.join('  /  '))} • ${p.comboProb}%</text>

    <rect x="688" y="${y + 96}" width="150" height="58" rx="12" fill="#1c2b4a"/>
    <text x="763" y="${y + 122}" font-family="DejaVu Sans" font-size="17" fill="#94a3b8" text-anchor="middle">ODD MÍN.</text>
    <text x="763" y="${y + 146}" font-family="DejaVu Sans" font-size="24" font-weight="700" fill="#f8fafc" text-anchor="middle">${p.comboOdd.toFixed(2)}</text>

    <rect x="854" y="${y + 96}" width="150" height="58" rx="12" fill="#1c2b4a"/>
    <text x="929" y="${y + 122}" font-family="DejaVu Sans" font-size="17" fill="#94a3b8" text-anchor="middle">CONFIANÇA</text>
    <text x="929" y="${y + 146}" font-family="DejaVu Sans" font-size="24" font-weight="700" fill="${conf}" text-anchor="middle">${p.confidence}% ${svgEscape(p.label)}</text>

    <text x="126" y="${y + 172}" font-family="DejaVu Sans" font-size="17" fill="#64748b">Gols esperados ${svgEscape(p.lambdas)} • amostra ${svgEscape(p.sample)} jogos</text>
  </g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#0a1020"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#fcd34d"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="8" fill="url(#gold)"/>
  <text x="40" y="86" font-family="DejaVu Sans" font-size="46" font-weight="700" fill="#f8fafc">PLACAR EXATO DO DIA</text>
  <text x="40" y="128" font-family="DejaVu Sans" font-size="24" fill="#f59e0b">ANALISTA JOILSON • NEXUS 33</text>
  <text x="40" y="166" font-family="DejaVu Sans" font-size="22" fill="#94a3b8">${svgEscape(dateLabel)} • modelo Poisson bivariado + Dixon-Coles</text>
  <line x1="40" y1="188" x2="1040" y2="188" stroke="#1e2b47" stroke-width="2"/>
  ${rows}
  <text x="40" y="${H - 38}" font-family="DejaVu Sans" font-size="19" fill="#64748b">Probabilidades do modelo com dados reais das equipes. Gestão de banca: máx. 1% por entrada.</text>
</svg>`;
}

function buildCaption(picks: Pick[], dateLabel: string): string {
  const lines: string[] = [];
  lines.push('🎯 <b>PLACAR EXATO DO DIA</b>');
  lines.push(`📅 ${escapeHtml(dateLabel)}`);
  lines.push('');
  picks.forEach((p, i) => {
    lines.push(`${i + 1}. <b>${escapeHtml(p.home)} x ${escapeHtml(p.away)}</b> — ${escapeHtml(p.time)}`);
    lines.push(`   🥇 ${escapeHtml(p.score)} (${p.scoreProb}%) • cobertura ${escapeHtml(p.combo.join(' / '))} (${p.comboProb}%) • odd mín. ${p.comboOdd.toFixed(2)}`);
  });
  lines.push('');
  lines.push('⚠️ Gestão de banca: máx. 1% por entrada.');
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const t0 = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');

    let body: any = {};
    try { body = await req.json(); } catch { /* cron manda body simples */ }
    const force = body?.force === true;

    // ── dedup: já enviou hoje?
    const today = brTodayDate();
    if (!force) {
      const { data: already } = await sb
        .from('telegram_signals')
        .select('id')
        .eq('reason', REASON)
        .gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString())
        .limit(1);
      if (already && already.length > 0) {
        console.log('[CS] já enviado nas últimas 20h — abortando');
        return new Response(JSON.stringify({ ok: true, skipped: 'already_sent_today' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── busca jogos de hoje e amanhã (BRT)
    const dates = [0, 1].map((i) => {
      const d = new Date(today + 'T00:00:00-03:00');
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
    console.log(`[CS] tz=${APP_TZ} datas=${dates.join(',')}`);

    const headers = { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' };
    const results = await Promise.all(dates.map((d) =>
      fetch(`${supabaseUrl}/functions/v1/football-api`, { method: 'POST', headers, body: JSON.stringify({ date: d }) })
        .then((r) => r.json()).catch(() => ({ matches: [] }))
    ));
    const matches: any[] = results.flatMap((r: any) => Array.isArray(r?.matches) ? r.matches : []);
    const eligible = matches.filter(isEligible);
    console.log(`[CS] jogos=${matches.length} elegíveis=${eligible.length}`);

    // Enriquece com histórico real (últimos jogos) antes de calcular o modelo
    const enriched = await enrich(eligible, supabaseUrl, supabaseKey);

    const picks: Pick[] = [];
    for (const m of enriched) {

      try {
        const p = buildPick(m);
        if (p) picks.push(p);
      } catch (e) {
        console.warn('[CS] erro ao analisar jogo:', e instanceof Error ? e.message : e);
      }
    }
    picks.sort((a, b) => b.confidence - a.confidence || b.comboProb - a.comboProb);
    const top = picks.slice(0, MAX_PICKS);
    console.log(`[CS] qualificados=${picks.length} enviados=${top.length}`);

    if (top.length === 0) {
      return new Response(JSON.stringify({ ok: true, picks: 0, message: 'sem placares com dados reais suficientes' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dateLabel = top[0].date || today;
    const caption = buildCaption(top, dateLabel);
    const botToken = getTelegramBotToken();

    let sentAsPhoto = false;
    let messageId: number | null = null;

    try {
      const png = await svgToPng(buildSvg(top, dateLabel));
      // Somente a foto — sem legenda (texto só entra se a imagem falhar)
      const r = await sendTelegramPhoto(botToken, TELEGRAM_CHAT_ID, png, '', { tag: 'CS-PHOTO', filename: 'placar-exato.png' });

      if (r.ok) {
        sentAsPhoto = true;
        messageId = r.data?.result?.message_id ?? null;
      } else {
        console.error('[CS] sendPhoto falhou, caindo para texto:', r.status, JSON.stringify(r.data || {}));
      }
    } catch (e) {
      console.error('[CS] render falhou, caindo para texto:', e instanceof Error ? e.message : e);
    }

    if (!sentAsPhoto) {
      const r = await sendTelegramMessage(TELEGRAM_CHAT_ID, caption, { tag: 'CS-TEXT' });
      if (r.ok) messageId = r.data?.result?.message_id ?? null;
      else {
        await enqueueTelegramOutbox(sb, {
          chat_id: TELEGRAM_CHAT_ID, text: caption, source: 'daily-correct-score-broadcast',
          last_error: r.error || JSON.stringify(r.data || {}),
        });
        return new Response(JSON.stringify({ ok: false, error: 'telegram_failed', queued: true }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const rows = top.map((p) => ({
      match_id: p.matchId,
      match_name: `${p.home} vs ${p.away}`,
      market: `Placar Exato ${p.score}`,
      market_type: 'correct_score',
      minute: 0,
      confidence: p.confidence,
      score: '0-0',
      reason: REASON,
      sensitivity: 'PRE',
      success: null,
      status: 'pendente',
      telegram_message_id: messageId,
      odd: p.scoreOdd,
      implied_probability: p.scoreProb,
      model_probability: p.scoreProb,
    }));
    const { error: insErr } = await sb.from('telegram_signals').insert(rows);
    if (insErr) console.error('[CS] insert falhou:', insErr.message);

    console.log(`[CS] ok photo=${sentAsPhoto} picks=${top.length} elapsed=${Date.now() - t0}ms`);
    return new Response(JSON.stringify({
      ok: true, picks: top.length, photo: sentAsPhoto, message_id: messageId, elapsed_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[CS] erro:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
