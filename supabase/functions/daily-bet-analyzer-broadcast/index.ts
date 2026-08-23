// ═══════════════════════════════════════════════════════════════
// daily-bet-analyzer-broadcast — 🎯 BET ANALYZER DO DIA (1x por dia)
// Envia SOMENTE uma imagem (PNG) no Telegram com os 5 cenários:
// Placar Exato, Ambas Marcam, Total 2.5, Resultado e Zebra.
// Projetado para rodar via pg_cron na VPS (self-hosted).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegramMessage, enqueueTelegramOutbox, escapeHtml, getTelegramBotToken } from '../_shared/telegram.ts';
import { brTime, brDate, APP_TZ } from '../_shared/timezone.ts';
import { loadMatchPool } from '../_shared/matchPool.ts';
import { toAnalyzed, runBetAnalyzer, type ScenarioCard } from '../_shared/betAnalyzer.ts';
import { svgToPng, svgEscape, truncate, sendTelegramPhoto, CARD_FONT } from '../_shared/renderCard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REASON = 'daily-bet-analyzer';
const F = CARD_FONT;

/* ------------------------------------------------------------------ */
/* Card visual                                                         */
/* ------------------------------------------------------------------ */

function buildSvg(cards: ScenarioCard[], dateLabel: string): string {
  const W = 1080;
  const ROW = 196;
  const TOP = 210;
  const H = TOP + cards.length * ROW + 70;

  const rows = cards.map((c, i) => {
    const y = TOP + i * ROW;
    const m = c.match;
    const scoreColor = c.score >= 80 ? '#22c55e' : c.score >= 70 ? '#fbbf24' : '#f97316';
    const indColor = c.indicator.value >= 70 ? '#22c55e' : c.indicator.value >= 50 ? '#fbbf24' : '#94a3b8';
    const stats = c.stats.slice(0, 3);
    const statCells = stats.map((s, k) => {
      const x = 126 + k * 300;
      return `<text x="${x}" y="${y + 148}" font-family="${F}" font-size="16" fill="#64748b">${svgEscape(truncate(s.label, 22))}</text>
      <text x="${x}" y="${y + 172}" font-family="${F}" font-size="20" font-weight="700" fill="#e2e8f0">${svgEscape(truncate(s.value, 24))}</text>`;
    }).join('');

    return `<g>
    <rect x="40" y="${y}" width="1000" height="${ROW - 18}" rx="18" fill="#111c33" stroke="#1e2b47"/>
    <circle cx="86" cy="${y + 46}" r="24" fill="url(#gold)"/>
    <text x="86" y="${y + 54}" font-family="${F}" font-size="22" font-weight="700" fill="#0b1220" text-anchor="middle">${i + 1}</text>
    <text x="126" y="${y + 38}" font-family="${F}" font-size="21" font-weight="700" fill="#f59e0b">${svgEscape(`${c.scenario.title.toUpperCase()}`)}</text>
    <text x="126" y="${y + 70}" font-family="${F}" font-size="28" font-weight="700" fill="#f8fafc">${svgEscape(truncate(`${m.homeTeam} x ${m.awayTeam}`, 38))}</text>
    <text x="126" y="${y + 100}" font-family="${F}" font-size="19" fill="#94a3b8">${svgEscape(truncate(m.league, 34))} • ${svgEscape(m.time)}</text>
    <text x="126" y="${y + 126}" font-family="${F}" font-size="22" font-weight="700" fill="#22d3ee">${svgEscape(truncate(c.headline, 44))}</text>
    ${statCells}
    <text x="980" y="${y + 48}" font-family="${F}" font-size="15" fill="#94a3b8" text-anchor="end">SCORE NEXUS</text>
    <text x="980" y="${y + 88}" font-family="${F}" font-size="38" font-weight="700" fill="${scoreColor}" text-anchor="end">${c.score}</text>
    <text x="980" y="${y + 114}" font-family="${F}" font-size="15" fill="#64748b" text-anchor="end">${svgEscape(c.rating)} • ${svgEscape(c.quality)}</text>
    <text x="980" y="${y + 146}" font-family="${F}" font-size="15" fill="#94a3b8" text-anchor="end">${svgEscape(truncate(c.indicator.label, 26))}</text>
    <text x="980" y="${y + 172}" font-family="${F}" font-size="24" font-weight="700" fill="${indColor}" text-anchor="end">${c.indicator.value}/100 ${svgEscape(c.indicator.level)}</text>
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
  <text x="40" y="86" font-family="${F}" font-size="46" font-weight="700" fill="#f8fafc">BET ANALYZER DO DIA</text>
  <text x="40" y="128" font-family="${F}" font-size="24" fill="#f59e0b">ANALISTA JOILSON • NEXUS 33</text>
  <text x="40" y="166" font-family="${F}" font-size="22" fill="#94a3b8">${svgEscape(dateLabel)} • 5 cenários • Score Nexus com dados reais</text>
  <line x1="40" y1="188" x2="1040" y2="188" stroke="#1e2b47" stroke-width="2"/>
  ${rows}
  <text x="40" y="${H - 30}" font-family="${F}" font-size="19" fill="#64748b">Modelo estatístico com histórico real das equipes. Gestão de banca: máx. 1% por entrada.</text>
</svg>`;
}

/** Texto usado apenas se a imagem falhar. */
function buildFallbackText(cards: ScenarioCard[], dateLabel: string): string {
  const lines = ['🎯 <b>BET ANALYZER DO DIA</b>', `📅 ${escapeHtml(dateLabel)}`, ''];
  cards.forEach((c, i) => {
    lines.push(`${i + 1}. <b>${escapeHtml(c.scenario.title)}</b> — ${escapeHtml(c.match.homeTeam)} x ${escapeHtml(c.match.awayTeam)} (${escapeHtml(c.match.time)})`);
    lines.push(`   ${escapeHtml(c.headline)} • Score ${c.score} (${escapeHtml(c.rating)})`);
  });
  lines.push('');
  lines.push('⚠️ Gestão de banca: máx. 1% por entrada.');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */

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
    if (!force) {
      const { data: already } = await sb
        .from('telegram_signals')
        .select('id')
        .eq('reason', REASON)
        .gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString())
        .limit(1);
      if (already && already.length > 0) {
        console.log('[BA] já enviado nas últimas 20h — abortando');
        return new Response(JSON.stringify({ ok: true, skipped: 'already_sent_today' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[BA] tz=${APP_TZ}`);
    const { enriched } = await loadMatchPool(supabaseUrl, supabaseKey, 'BA');

    const analyzed = enriched.map((m: any) => {
      const iso = m.fixture?.date || null;
      return toAnalyzed(m, {
        time: iso ? `${brDate(iso)} ${brTime(iso)}` : '',
        iso,
        league: (m.league?.name || m.league || '').toString(),
        country: m.league?.country,
        live: false,
        homeTeam: m.teams?.home?.name || m.homeTeam || 'Casa',
        awayTeam: m.teams?.away?.name || m.awayTeam || 'Fora',
      });
    });

    const result = runBetAnalyzer(analyzed);
    const cards = result.cards;
    console.log(`[BA] analisados=${result.analyzedCount} cenários=${cards.length} faltando=${result.missing.length}`);

    if (cards.length === 0) {
      return new Response(JSON.stringify({ ok: true, picks: 0, message: 'sem cenários com dados reais suficientes' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dateLabel = brDate(new Date());
    const botToken = getTelegramBotToken();
    let sentAsPhoto = false;
    let messageId: number | null = null;

    try {
      const png = await svgToPng(buildSvg(cards, dateLabel));
      // Somente a foto — sem legenda
      const r = await sendTelegramPhoto(botToken, TELEGRAM_CHAT_ID, png, '', { tag: 'BA-PHOTO', filename: 'bet-analyzer.png' });
      if (r.ok) {
        sentAsPhoto = true;
        messageId = r.data?.result?.message_id ?? null;
      } else {
        console.error('[BA] sendPhoto falhou, caindo para texto:', r.status, JSON.stringify(r.data || {}));
      }
    } catch (e) {
      console.error('[BA] render falhou, caindo para texto:', e instanceof Error ? e.message : e);
    }

    if (!sentAsPhoto) {
      const text = buildFallbackText(cards, dateLabel);
      const r = await sendTelegramMessage(TELEGRAM_CHAT_ID, text, { tag: 'BA-TEXT' });
      if (r.ok) messageId = r.data?.result?.message_id ?? null;
      else {
        await enqueueTelegramOutbox(sb, {
          chat_id: TELEGRAM_CHAT_ID, text, source: 'daily-bet-analyzer-broadcast',
          last_error: r.error || JSON.stringify(r.data || {}),
        });
        return new Response(JSON.stringify({ ok: false, error: 'telegram_failed', queued: true }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── registra os sinais para acompanhamento de resultados
    const rows = cards.map((c) => ({
      match_id: c.match.id,
      match_name: `${c.match.homeTeam} vs ${c.match.awayTeam}`,
      market: `${c.scenario.title}: ${c.headline}`,
      market_type: c.scenario.key,
      minute: 0,
      confidence: c.score,
      score: '0-0',
      reason: REASON,
      sensitivity: 'PRE',
      success: null,
      status: 'pendente',
      telegram_message_id: messageId,
    }));
    const { error: insErr } = await sb.from('telegram_signals').insert(rows);
    if (insErr) console.error('[BA] falha ao registrar sinais:', insErr.message);

    console.log(`[BA] ok photo=${sentAsPhoto} cards=${cards.length} elapsed=${Date.now() - t0}ms`);
    return new Response(JSON.stringify({
      ok: true, picks: cards.length, photo: sentAsPhoto, message_id: messageId, elapsed_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[BA] erro fatal:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
