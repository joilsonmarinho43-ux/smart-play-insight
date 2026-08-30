// ═══════════════════════════════════════════════════════════════
// daily-ticket-settle — fecha o BILHETE diário enviado ao Telegram.
// Quando o ÚLTIMO jogo do bilhete (Bet Analyzer / Placar Exato)
// termina, responde à foto original com o resultado: ✅ WIN / ❌ LOSS
// por mercado + placar final e o resumo do bilhete.
// Roda via pg_cron (a cada 30 min) na VPS.
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { telegramRequest, getTelegramBotToken, escapeHtml } from '../_shared/telegram.ts';
import { svgToPng, svgEscape, truncate, sendTelegramPhoto, CARD_FONT } from '../_shared/renderCard.ts';
import { brDate } from '../_shared/timezone.ts';
import { corsHeaders } from '../_shared/cors.ts';


const REASONS = ['daily-bet-analyzer', 'daily-correct-score'];
/** Após esse tempo sem dado do jogo, o palpite vira VOID (não trava o bilhete). */
const STALE_HOURS = 20;

type Verdict = 'green' | 'loss' | 'void' | 'pendente';

interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  finished: boolean;
  status: string;
}

/* ------------------------------------------------------------------ */
/* Resolução de resultados                                             */
/* ------------------------------------------------------------------ */

async function loadResults(
  supabaseUrl: string,
  supabaseKey: string,
  sb: any,
  ids: string[],
): Promise<Record<string, MatchResult>> {
  const out: Record<string, MatchResult> = {};
  const headers = { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' };

  // 1) pool ao vivo (cacheado) — cobre jogos em andamento e recém-encerrados
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/football-api`, {
      method: 'POST', headers, body: JSON.stringify({ live: true }),
    });
    const json = await r.json();
    for (const m of json?.matches || []) {
      const id = String(m.id ?? m.fixture?.id ?? '');
      if (!ids.includes(id)) continue;
      const status = String(m.fixture?.status?.short || m.status?.short || '');
      if (!Number.isFinite(Number(m.goals?.home)) || !Number.isFinite(Number(m.goals?.away))) continue;
      out[id] = {
        homeGoals: Number(m.goals.home),
        awayGoals: Number(m.goals.away),
        finished: ['FT', 'AET', 'PEN'].includes(status),
        status,
      };
    }
  } catch (e) {
    console.error('[SETTLE] live pool falhou:', e instanceof Error ? e.message : e);
  }

  // 2) cache de estatísticas por fixture
  for (const id of ids.filter((i) => !out[i])) {
    const { data: cached } = await sb
      .from('cache_api').select('dados_json').eq('cache_key', `stats_${id}`).maybeSingle();
    const goals = cached?.dados_json?.goals;
    const status = String(cached?.dados_json?.fixture?.status?.short || '');
    if (goals && Number.isFinite(Number(goals.home)) && Number.isFinite(Number(goals.away))) {
      out[id] = {
        homeGoals: Number(goals.home), awayGoals: Number(goals.away),
        finished: ['FT', 'AET', 'PEN'].includes(status), status,
      };
    }
  }

  // 3) consulta direta por fixture
  for (const id of ids.filter((i) => !out[i])) {
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/football-api`, {
        method: 'POST', headers, body: JSON.stringify({ fixture: id }),
      });
      const json = await r.json();
      const m = json?.matches?.[0] || json?.match || json?.fixture;
      const goals = m?.goals;
      const status = String(m?.fixture?.status?.short || m?.status?.short || '');
      if (goals && Number.isFinite(Number(goals.home)) && Number.isFinite(Number(goals.away))) {
        out[id] = {
          homeGoals: Number(goals.home), awayGoals: Number(goals.away),
          finished: ['FT', 'AET', 'PEN'].includes(status), status,
        };
      }
    } catch (e) {
      console.error(`[SETTLE] fixture ${id} falhou:`, e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Conferência por mercado                                             */
/* ------------------------------------------------------------------ */

function settle(signal: any, d: MatchResult): Verdict {
  if (!d.finished) return 'pendente';
  const total = d.homeGoals + d.awayGoals;
  const type = String(signal.market_type || '').toLowerCase();
  const market = String(signal.market || '');
  const ml = market.toLowerCase();
  const [homeName, awayName] = String(signal.match_name || '').split(' vs ');

  // Placar exato — "Placar Exato 2-1" ou "Placar Exato: Time 2 x 1 Time"
  if (type === 'correct_score') {
    const m = ml.match(/(\d+)\s*[x\-–]\s*(\d+)/);
    if (!m) return 'void';
    return Number(m[1]) === d.homeGoals && Number(m[2]) === d.awayGoals ? 'green' : 'loss';
  }

  // Ambas marcam
  if (type === 'btts') {
    const yes = !/n[ãa]o/.test(ml);
    const both = d.homeGoals > 0 && d.awayGoals > 0;
    return (yes ? both : !both) ? 'green' : 'loss';
  }

  // Over/Under 2.5 (ou qualquer linha declarada)
  if (type === 'goals25' || /over|under/.test(ml)) {
    const line = Number((ml.match(/(\d+\.\d+)/) || [])[1] ?? 2.5);
    const over = ml.includes('over');
    return (over ? total > line : total < line) ? 'green' : 'loss';
  }

  // Resultado da partida — CASA / EMPATE / FORA
  if (type === 'result') {
    const pick = ml.includes('empate') ? 'EMPATE' : ml.includes('fora') ? 'FORA' : ml.includes('casa') ? 'CASA' : null;
    if (!pick) return 'void';
    const real = d.homeGoals > d.awayGoals ? 'CASA' : d.homeGoals < d.awayGoals ? 'FORA' : 'EMPATE';
    return pick === real ? 'green' : 'loss';
  }

  // Zebra / Dupla Chance — azarão vence OU empata
  if (type === 'upset') {
    const tail = (market.split(':').pop() || '').trim().toLowerCase();
    const und = tail.replace(/\s+ou\s+empate\s*$/, '').trim();
    if (!und || !homeName || !awayName) return 'void';
    const h = homeName.toLowerCase().trim();
    const undIsHome = h.includes(und) || und.includes(h);
    const doubleChance = /dupla chance/.test(ml);
    const won = undIsHome ? d.homeGoals > d.awayGoals : d.awayGoals > d.homeGoals;
    const drew = d.homeGoals === d.awayGoals;
    return (won || (doubleChance && drew)) ? 'green' : 'loss';
  }

  return 'void';
}

const ICON: Record<Verdict, string> = { green: '✅', loss: '❌', void: '⚪', pendente: '⏳' };
const VERDICT_TXT: Record<Verdict, string> = { green: 'WIN', loss: 'LOSS', void: 'ANULADO', pendente: '—' };

/* ------------------------------------------------------------------ */
/* Card de conferência (imagem)                                        */
/* ------------------------------------------------------------------ */

function buildResultSvg(
  title: string,
  dateLabel: string,
  rows: { s: any; d?: MatchResult; v: Verdict }[],
): string {
  const F = CARD_FONT;
  const W = 1080;
  const ROW = 150;
  const TOP = 210;
  const H = TOP + rows.length * ROW + 120;

  const greens = rows.filter((r) => r.v === 'green').length;
  const losses = rows.filter((r) => r.v === 'loss').length;
  const decided = greens + losses;
  const wr = decided > 0 ? Math.round((greens / decided) * 100) : 0;
  const headline = decided === 0 ? 'BILHETE ANULADO' : losses === 0 ? 'BILHETE — WIN' : greens === 0 ? 'BILHETE — LOSS' : 'BILHETE — PARCIAL';
  const headColor = decided === 0 ? '#94a3b8' : losses === 0 ? '#22c55e' : greens === 0 ? '#ef4444' : '#fbbf24';

  const body = rows.map((r, i) => {
    const y = TOP + i * ROW;
    const color = r.v === 'green' ? '#22c55e' : r.v === 'loss' ? '#ef4444' : '#94a3b8';
    const placar = r.d ? `${r.d.homeGoals} x ${r.d.awayGoals}` : '—';
    const market = String(r.s.market || '');
    const [head, ...rest] = market.split(':');
    const pick = rest.join(':').trim() || head;
    return `<g>
    <rect x="40" y="${y}" width="1000" height="${ROW - 18}" rx="18" fill="#111c33" stroke="${color}" stroke-opacity="0.35"/>
    <text x="76" y="${y + 58}" font-family="${F}" font-size="34">${ICON[r.v]}</text>
    <text x="126" y="${y + 40}" font-family="${F}" font-size="18" font-weight="700" fill="#f59e0b">${svgEscape(truncate(head.toUpperCase(), 34))}</text>
    <text x="126" y="${y + 72}" font-family="${F}" font-size="25" font-weight="700" fill="#f8fafc">${svgEscape(truncate(String(r.s.match_name || '').replace(' vs ', ' x '), 34))}</text>
    <text x="126" y="${y + 102}" font-family="${F}" font-size="19" fill="#22d3ee">${svgEscape(truncate(pick, 44))}</text>
    <text x="1020" y="${y + 46}" font-family="${F}" font-size="15" fill="#94a3b8" text-anchor="end">PLACAR FINAL</text>
    <text x="1020" y="${y + 82}" font-family="${F}" font-size="30" font-weight="700" fill="#e2e8f0" text-anchor="end">${svgEscape(placar)}</text>
    <text x="1020" y="${y + 110}" font-family="${F}" font-size="20" font-weight="700" fill="${color}" text-anchor="end">${VERDICT_TXT[r.v]}</text>
  </g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1220"/><stop offset="100%" stop-color="#0a1020"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#fcd34d"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="8" fill="url(#gold)"/>
  <text x="40" y="86" font-family="${F}" font-size="44" font-weight="700" fill="${headColor}">${svgEscape(headline)}</text>
  <text x="40" y="128" font-family="${F}" font-size="24" fill="#f59e0b">${svgEscape(title)} • ANALISTA JOILSON</text>
  <text x="40" y="166" font-family="${F}" font-size="22" fill="#94a3b8">${svgEscape(dateLabel)} • conferência mercado a mercado</text>
  <line x1="40" y1="188" x2="1040" y2="188" stroke="#1e2b47" stroke-width="2"/>
  ${body}
  <text x="40" y="${H - 46}" font-family="${F}" font-size="26" font-weight="700" fill="#e2e8f0">${greens} WIN • ${losses} LOSS${rows.length - decided > 0 ? ` • ${rows.length - decided} anulado(s)` : ''}</text>
  <text x="1040" y="${H - 46}" font-family="${F}" font-size="26" font-weight="700" fill="${headColor}" text-anchor="end">Aproveitamento ${wr}%</text>
</svg>`;
}


/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);
    const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');
    const botToken = getTelegramBotToken();

    const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data: signals, error } = await sb
      .from('telegram_signals')
      .select('*')
      .in('reason', REASONS)
      .not('telegram_message_id', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // agrupa por bilhete (mensagem/foto enviada)
    const tickets = new Map<string, any[]>();
    for (const s of signals || []) {
      const key = `${s.reason}:${s.telegram_message_id}`;
      (tickets.get(key) ?? tickets.set(key, []).get(key)!).push(s);
    }

    const ids = [...new Set((signals || []).map((s: any) => s.match_id).filter(Boolean))].map(String);
    const results = ids.length ? await loadResults(supabaseUrl, supabaseKey, sb, ids) : {};

    let closed = 0, updated = 0;

    for (const [key, group] of tickets) {
      // já fechado?
      if (group.every((g) => g.edited_message)) continue;

      const rows = group.map((s) => {
        const d = results[String(s.match_id)];
        const ageH = (Date.now() - new Date(s.created_at).getTime()) / 3_600_000;
        let v: Verdict = 'pendente';
        if (d) v = settle(s, d);
        // sem dado por muito tempo → não trava o bilhete
        if (v === 'pendente' && ageH > STALE_HOURS) v = 'void';
        return { s, d, v };
      });

      // persiste os resolvidos
      for (const r of rows) {
        if (r.v === 'pendente' || r.s.status !== 'pendente') continue;
        await sb.from('telegram_signals').update({
          status: r.v,
          result: r.v,
          success: r.v === 'green' ? true : r.v === 'loss' ? false : null,
          settled_at: new Date().toISOString(),
        }).eq('id', r.s.id);
        updated++;
      }

      // só fecha o bilhete quando o ÚLTIMO jogo terminou
      if (rows.some((r) => r.v === 'pendente')) continue;

      const greens = rows.filter((r) => r.v === 'green').length;
      const losses = rows.filter((r) => r.v === 'loss').length;
      const decided = greens + losses;
      const allGreen = decided > 0 && losses === 0;
      const header = allGreen
        ? '✅ <b>BILHETE FECHADO — WIN</b>'
        : greens > 0
          ? '📊 <b>BILHETE FECHADO — PARCIAL</b>'
          : '❌ <b>BILHETE FECHADO — LOSS</b>';

      const title = group[0].reason === 'daily-correct-score' ? 'Placar Exato do dia' : 'Bet Analyzer do dia';
      const lines = rows.map((r) => {
        const placar = r.d ? `${r.d.homeGoals} x ${r.d.awayGoals}` : '—';
        return `${ICON[r.v]} <b>${escapeHtml(r.s.match_name)}</b> — ${placar}\n     ${escapeHtml(r.s.market)}`;
      });
      const wr = decided > 0 ? Math.round((greens / decided) * 100) : 0;

      const text = [
        header,
        `🎯 ${escapeHtml(title)}`,
        '',
        ...lines,
        '',
        `📈 ${greens} WIN • ${losses} LOSS${rows.length - decided > 0 ? ` • ${rows.length - decided} anulado(s)` : ''} — aproveitamento <b>${wr}%</b>`,
        '',
        '🤖 <i>Nexus 33 — conferência automática</i>',
      ].join('\n');

      // 1) tenta responder com a IMAGEM de conferência (mercado a mercado)
      let sent: { ok: boolean; status: number; data: any } = { ok: false, status: 0, data: null };
      try {
        const png = await svgToPng(buildResultSvg(title, brDate(new Date()), rows));
        const p = await sendTelegramPhoto(botToken, CHAT_ID, png, '', {
          tag: 'SETTLE-PHOTO',
          filename: 'conferencia.png',
          replyTo: Number(group[0].telegram_message_id),
        });
        sent = { ok: p.ok, status: p.status, data: p.data };
      } catch (e) {
        console.error('[SETTLE] render da conferência falhou:', e instanceof Error ? e.message : e);
      }

      // 2) fallback em texto
      if (!sent.ok) {
        sent = await telegramRequest('sendMessage', {
          chat_id: CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_to_message_id: Number(group[0].telegram_message_id),
          allow_sending_without_reply: true,
        }, { botToken, tag: 'SETTLE' });
      }


      if (sent.ok) {
        await sb.from('telegram_signals')
          .update({ edited_message: true })
          .in('id', group.map((g) => g.id));
        closed++;
        console.log(`[SETTLE] bilhete ${key} fechado: ${greens}W/${losses}L`);
      } else {
        console.error(`[SETTLE] falha ao responder bilhete ${key}:`, sent.status, JSON.stringify(sent.data || {}));
      }
    }

    return new Response(JSON.stringify({
      ok: true, tickets: tickets.size, closed, updated, elapsed_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SETTLE] erro fatal:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
