import { requireInternalServiceCall, requireAdminUser } from '../_shared/internalAuth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTelegramMessage, getTelegramBotToken } from '../_shared/telegram.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return new Response(JSON.stringify({ ok: false, error: 'SERVER_CONFIG_MISSING' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const sb = createClient(supabaseUrl, supabaseKey);
  const internal = requireInternalServiceCall(req, corsHeaders);
  if (internal) return internal;

  try {
    const TELEGRAM_BOT_TOKEN = getTelegramBotToken();
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey) {
      throw new Error('Variáveis de ambiente não configuradas');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get signals from the last 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoISO = weekAgo.toISOString();

    const { data: signals, error } = await supabase
      .from('telegram_signals')
      .select('*')
      .gte('created_at', weekAgoISO);

    if (error) throw error;

    const total = signals?.length || 0;
    const greens = signals?.filter((s: any) => s.status === 'green').length || 0;
    const losses = signals?.filter((s: any) => s.status === 'loss').length || 0;
    const pending = signals?.filter((s: any) => s.status === 'pendente').length || 0;
    const winRate = greens + losses > 0 ? ((greens / (greens + losses)) * 100).toFixed(1) : '0.0';

    // Financial calculation uses the persisted signal ledger.
    // Stake remains a reporting assumption, while ROI/odds come from each
    // resolved signal; never substitute a synthetic average odd.
    const stakeBase = 20;
    const resolvedSignals = (signals || []).filter((s: any) => s.status === 'green' || s.status === 'loss');
    const observedOdds = resolvedSignals
      .map((s: any) => Number(s.odd))
      .filter((odd: number) => Number.isFinite(odd) && odd > 1);
    const oddMedia = observedOdds.length > 0
      ? observedOdds.reduce((sum: number, odd: number) => sum + odd, 0) / observedOdds.length
      : null;
    const roiUnits = resolvedSignals.reduce((sum: number, s: any) => {
      const value = Number(s.roi);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    const lucroLiquido = roiUnits * stakeBase;
    const lucroGreens = resolvedSignals.reduce((sum: number, s: any) => {
      if (s.status !== 'green') return sum;
      const odd = Number(s.odd);
      return Number.isFinite(odd) && odd > 1 ? sum + stakeBase * (odd - 1) : sum;
    }, 0);
    const prejuizoLosses = losses * stakeBase;
    const resolvedStake = resolvedSignals.length * stakeBase;
    const roi = resolvedStake > 0 ? ((lucroLiquido / resolvedStake) * 100).toFixed(1) : '0.0';

    // Build performance bars
    const barLength = 10;
    const greenBars = greens + losses > 0 ? Math.round((greens / (greens + losses)) * barLength) : 0;
    const lossBars = barLength - greenBars;
    const progressBar = '🟢'.repeat(greenBars) + '🔴'.repeat(lossBars);

    // Date range
    const startDate = weekAgo.toLocaleDateString('pt-BR');
    const endDate = new Date().toLocaleDateString('pt-BR');

    const emoji = parseFloat(winRate) >= 60 ? '🏆' : parseFloat(winRate) >= 50 ? '📊' : '⚠️';
    const lucroEmoji = lucroLiquido >= 0 ? '💰' : '📉';

    const message = `
${emoji} <b>RELATÓRIO SEMANAL DE PERFORMANCE</b> ${emoji}
━━━━━━━━━━━━━━━━━━━━━━

📅 <b>Período:</b> ${startDate} → ${endDate}

📊 <b>RESULTADOS</b>
├ Total de Sinais: <b>${total}</b>
├ ✅ GREEN: <b>${greens}</b>
├ ❌ LOSS: <b>${losses}</b>
├ ⏳ Pendente: <b>${pending}</b>
└ 🎯 Win Rate: <b>${winRate}%</b>

${progressBar}

${lucroEmoji} <b>ESTIMATIVA FINANCEIRA</b>
├ Stake Base: R$ ${stakeBase.toFixed(2)}
├ Odd Média Observada: ${oddMedia !== null ? oddMedia.toFixed(2) : '—'}
├ Lucro Bruto: R$ ${lucroGreens.toFixed(2)}
├ Prejuízo: R$ ${prejuizoLosses.toFixed(2)}
├ <b>Lucro Líquido: R$ ${lucroLiquido.toFixed(2)}</b>
└ ROI: <b>${roi}%</b>

━━━━━━━━━━━━━━━━━━━━━━
🤖 <i>Nexus 33 — Relatório Automático</i>
    `.trim();

    const tg = await sendTelegramMessage(TELEGRAM_CHAT_ID, message, {
      botToken: TELEGRAM_BOT_TOKEN,
      tag: 'WEEKLY-REPORT',
    });
    const result = tg.data ?? {};

    if (!tg.ok) {
      throw new Error(`Telegram API error [${tg.status}]: ${JSON.stringify(result)}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        stats: { total, greens, losses, pending, winRate, lucroLiquido, roi },
        message_id: result.result?.message_id 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Weekly report error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
