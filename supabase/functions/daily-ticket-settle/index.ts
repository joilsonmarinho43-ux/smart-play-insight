// ═══════════════════════════════════════════════════════════════
// daily-ticket-settle — fecha o BILHETE diário enviado ao Telegram.
// Quando o ÚLTIMO jogo do bilhete (Bet Analyzer / Placar Exato)
// termina, responde à foto original com o resultado: ✅ WIN / ❌ LOSS
// por mercado + placar final e o resumo do bilhete.
// Roda via pg_cron (a cada 30 min) na VPS.
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { telegramRequest, getTelegramBotToken, escapeHtml } from '../_shared/telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  // Zebra — o azarão indicado vence
  if (type === 'upset') {
    const und = (market.split(':').pop() || '').trim().toLowerCase();
    if (!und || !homeName || !awayName) return 'void';
    const undIsHome = homeName.toLowerCase().includes(und) || und.includes(homeName.toLowerCase());
    const won = undIsHome ? d.homeGoals > d.awayGoals : d.awayGoals > d.homeGoals;
    return won ? 'green' : 'loss';
  }

  return 'void';
}

const ICON: Record<Verdict, string> = { green: '✅', loss: '❌', void: '⚪', pendente: '⏳' };

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

      const sent = await telegramRequest('sendMessage', {
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_to_message_id: Number(group[0].telegram_message_id),
        allow_sending_without_reply: true,
      }, { botToken, tag: 'SETTLE' });

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
