import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegramMessage, editTelegramMessage, getTelegramBotToken, escapeHtml } from '../_shared/telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Verdict = 'green' | 'loss' | 'pendente' | 'void';

interface MatchData {
  homeGoals: number; awayGoals: number;
  htHomeGoals: number; htAwayGoals: number;
  corners: number; cards: number;
  finished: boolean;
  homeName?: string; awayName?: string;
}

function checkMarketResult(market: string, marketType: string | null, d: MatchData): Verdict {
  const total = d.homeGoals + d.awayGoals;
  const ml = (market || '').toLowerCase();
  const t = (marketType || '').toLowerCase();

  // OVER GOLS
  const overGoals = ml.match(/over\s*(\d+\.?\d*)\s*(?:gols|goals)?\s*$/);
  if (t === 'over_goals' || (overGoals && !ml.includes('escanteios') && !ml.includes('cartões') && !ml.includes('corners') && !ml.includes('cards'))) {
    const m = ml.match(/(\d+\.\d+)/);
    if (!m) return d.finished ? 'void' : 'pendente';
    const th = parseFloat(m[1]);
    if (total > th) return 'green';
    return d.finished ? 'loss' : 'pendente';
  }

  // BTTS
  if (t === 'btts' || ml.includes('ambas marcam') || ml.includes('btts')) {
    if (d.homeGoals > 0 && d.awayGoals > 0) return 'green';
    return d.finished ? 'loss' : 'pendente';
  }

  // Escanteios
  if (t === 'corners' || ml.includes('escanteio') || ml.includes('corner')) {
    const m = ml.match(/(\d+\.\d+)/);
    if (!m) return d.finished ? 'void' : 'pendente';
    const th = parseFloat(m[1]);
    if (d.corners > th) return 'green';
    return d.finished ? 'loss' : 'pendente';
  }

  // Cartões
  if (t === 'cards' || ml.includes('cartões') || ml.includes('cards') || ml.includes('cartoes')) {
    const m = ml.match(/(\d+\.\d+)/);
    if (!m) return d.finished ? 'void' : 'pendente';
    const th = parseFloat(m[1]);
    if (d.cards > th) return 'green';
    return d.finished ? 'loss' : 'pendente';
  }

  // Gol HT
  if (t === 'ht_goal' || ml.includes('1º tempo') || ml.includes('1o tempo') || ml.includes('1t')) {
    const ht = d.htHomeGoals + d.htAwayGoals;
    if (ht > 0) return 'green';
    return d.finished ? 'loss' : 'pendente';
  }

  // Gol FT (2º tempo)
  if (t === 'ft_goal' || ml.includes('2º tempo') || ml.includes('2o tempo') || ml.includes('2t')) {
    if (!d.finished) return 'pendente';
    const ft2 = total - (d.htHomeGoals + d.htAwayGoals);
    return ft2 > 0 ? 'green' : 'loss';
  }

  // Vitória
  if (ml.startsWith('vitória') || ml.startsWith('vitoria')) {
    if (!d.finished) return 'pendente';
    const isHomeWin = d.homeGoals > d.awayGoals;
    const team = ml.replace(/vit[óo]ria/, '').trim();
    if (d.homeName && team.includes(d.homeName.toLowerCase())) return isHomeWin ? 'green' : 'loss';
    if (d.awayName && team.includes(d.awayName.toLowerCase())) return d.awayGoals > d.homeGoals ? 'green' : 'loss';
    return 'void';
  }

  return d.finished ? 'void' : 'pendente';
}

function calcRoi(odd: number | null, status: 'green' | 'loss' | 'void'): number {
  if (!odd || status === 'void') return 0;
  if (status === 'green') return +(odd - 1).toFixed(3);
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const TELEGRAM_BOT_TOKEN = getTelegramBotToken();
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const API_KEY = Deno.env.get('API_FUTEBOL_KEY');
    if (!TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey || !API_KEY) throw new Error('env missing');

    const sb = createClient(supabaseUrl, supabaseKey);
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

    const { data: pending } = await sb
      .from('telegram_signals')
      .select('*')
      .eq('status', 'pendente')
      .not('match_id', 'is', null)
      .gte('created_at', since);

    let validated = 0, greens = 0, losses = 0, voids = 0;
    const fixtures: Record<string, MatchData> = {};

    if (pending && pending.length > 0) {
      const ids = [...new Set(pending.map(s => s.match_id).filter(Boolean))];
      for (const id of ids) {
        try {
          const r = await fetch(`https://v3.football.api-sports.io/fixtures?id=${id}`, {
            headers: { 'x-apisports-key': API_KEY },
          });
          const j = await r.json();
          const f = j.response?.[0];
          if (!f) continue;
          const stats = f.statistics || [];
          const corners = stats.reduce((s: number, t: any) =>
            s + (t.statistics?.find((x: any) => x.type === 'Corner Kicks')?.value ?? 0), 0);
          const yellows = stats.reduce((s: number, t: any) =>
            s + (t.statistics?.find((x: any) => x.type === 'Yellow Cards')?.value ?? 0), 0);
          const reds = stats.reduce((s: number, t: any) =>
            s + (t.statistics?.find((x: any) => x.type === 'Red Cards')?.value ?? 0), 0);
          fixtures[id] = {
            homeGoals: f.goals?.home ?? 0,
            awayGoals: f.goals?.away ?? 0,
            htHomeGoals: f.score?.halftime?.home ?? 0,
            htAwayGoals: f.score?.halftime?.away ?? 0,
            corners, cards: yellows + reds,
            finished: ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short),
            homeName: f.teams?.home?.name,
            awayName: f.teams?.away?.name,
          };
        } catch (e) {
          console.error(`[VAL] fetch ${id}`, e);
        }
        await new Promise(r => setTimeout(r, 200));
      }

      // group signals by match for editing once
      const byMatch: Record<string, any[]> = {};
      for (const s of pending) {
        const data = fixtures[s.match_id];
        if (!data) continue;
        const age = Date.now() - new Date(s.created_at).getTime();
        const timeout = age > 6 * 60 * 60 * 1000;
        const v = checkMarketResult(s.market, s.market_type, { ...data, finished: data.finished || timeout });
        if (v === 'pendente') continue;

        const odd = s.odd ? Number(s.odd) : null;
        const finalStatus = v;
        const success = v === 'green' ? true : v === 'loss' ? false : null;
        const roi = calcRoi(odd, v);

        await sb.from('telegram_signals').update({
          status: v, result: v, success, roi, settled_at: new Date().toISOString(),
        }).eq('id', s.id);

        validated++;
        if (v === 'green') greens++;
        else if (v === 'loss') losses++;
        else voids++;

        (byMatch[s.match_id] ||= []).push({ ...s, _verdict: v });
      }

      // edit telegram message once per match (with all market verdicts)
      for (const [mid, group] of Object.entries(byMatch)) {
        const data = fixtures[mid];
        const msgId = group.find(g => g.telegram_message_id)?.telegram_message_id;
        if (!msgId || group.some(g => g.edited_message)) continue;

        const allGreen = group.every(g => g._verdict === 'green');
        const anyLoss = group.some(g => g._verdict === 'loss');
        const header = allGreen ? '✅ <b>GREEN CONFIRMADO</b>' : anyLoss ? '❌ <b>LOSS REGISTRADO</b>' : '⚪ <b>VOID</b>';
        const matchName = group[0].match_name;

        const lines = group.map(g => {
          const ico = g._verdict === 'green' ? '✅' : g._verdict === 'loss' ? '❌' : '⚪';
          return `${ico} ${escapeHtml(g.market)} (${g.confidence}%)`;
        });

        const text = [
          header,
          '',
          `⚔️ ${escapeHtml(matchName)}`,
          `📊 Placar final: <b>${data.homeGoals} x ${data.awayGoals}</b>`,
          '',
          '🎯 <b>Mercados validados:</b>',
          ...lines,
          '',
          '🤖 <i>Nexus 33 — Validação automática</i>',
        ].join('\n');

        const er = await editTelegramMessage(TELEGRAM_CHAT_ID, msgId, text, {
          botToken: TELEGRAM_BOT_TOKEN, tag: 'DAILY-VAL',
        });
        if (er.ok) {
          await sb.from('telegram_signals').update({ edited_message: true })
            .in('id', group.map(g => g.id));
        }
      }
    }

    // ── 24h summary + ROI
    const { data: all } = await sb
      .from('telegram_signals')
      .select('status, success, odd, roi, market_type, market')
      .gte('created_at', since);

    const sigs = all || [];
    const total = sigs.length;
    const tg = sigs.filter(s => s.status === 'green').length;
    const tl = sigs.filter(s => s.status === 'loss').length;
    const tp = sigs.filter(s => s.status === 'pendente').length;
    const resolved = tg + tl;
    const winRate = resolved > 0 ? ((tg / resolved) * 100).toFixed(1) : '-';
    const totalRoi = sigs.reduce((sum, s) => sum + (Number(s.roi) || 0), 0);
    const roiPct = resolved > 0 ? ((totalRoi / resolved) * 100).toFixed(1) : '0';

    // ROI por tipo de mercado
    const byType: Record<string, { g: number; l: number; roi: number }> = {};
    for (const s of sigs) {
      if (s.status !== 'green' && s.status !== 'loss') continue;
      const k = s.market_type || 'outros';
      const r = byType[k] ||= { g: 0, l: 0, roi: 0 };
      if (s.status === 'green') r.g++; else r.l++;
      r.roi += Number(s.roi) || 0;
    }
    const typeLines = Object.entries(byType)
      .sort((a, b) => (b[1].g + b[1].l) - (a[1].g + a[1].l))
      .map(([k, v]) => {
        const r = v.g + v.l;
        const wr = r ? ((v.g / r) * 100).toFixed(0) : '-';
        const rp = r ? ((v.roi / r) * 100).toFixed(1) : '0';
        return `  ${k}: ${v.g}✅ ${v.l}❌ (${wr}% • ROI ${rp}%)`;
      });

    const barLen = 10;
    const gBars = resolved > 0 ? Math.round((tg / resolved) * barLen) : 0;
    const bar = '🟢'.repeat(gBars) + '🔴'.repeat(barLen - gBars);
    const perfEmoji = parseFloat(winRate || '0') >= 65 ? '🏆' : parseFloat(winRate || '0') >= 50 ? '📊' : '⚠️';

    const summary = [
      `${perfEmoji} <b>RESUMO 24H</b>`,
      '',
      bar,
      `✅ ${tg} GREEN  ❌ ${tl} LOSS  ⏳ ${tp}`,
      `🎯 Win Rate: <b>${winRate}%</b> (${resolved} resolvidos)`,
      `💹 ROI: <b>${roiPct}%</b>`,
      '',
      '<b>Por tipo de mercado:</b>',
      ...typeLines,
      '',
      '🤖 <i>Nexus 33 • Relatório Automático</i>',
    ].join('\n');

    const tgRes = await sendTelegramMessage(TELEGRAM_CHAT_ID, summary, {
      botToken: TELEGRAM_BOT_TOKEN, tag: 'DAILY-VAL',
    });

    const elapsed = Date.now() - t0;
    console.log(`[DAILY-VAL] validated=${validated} greens=${greens} losses=${losses} voids=${voids} elapsed=${elapsed}ms`);

    return new Response(JSON.stringify({
      ok: true, validated, greens, losses, voids,
      summary: { total, tg, tl, tp, winRate, roi: roiPct },
      telegram_ok: tgRes.ok, elapsed_ms: elapsed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[DAILY-VAL] error:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
