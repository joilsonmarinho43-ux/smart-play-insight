import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseKey) {
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
      .gte('created_at', weekAgoISO)
      .eq('success', true);

    if (error) throw error;

    const total = signals?.length || 0;
    const greens = signals?.filter((s: any) => s.status === 'green').length || 0;
    const losses = signals?.filter((s: any) => s.status === 'loss').length || 0;
    const pending = signals?.filter((s: any) => s.status === 'pendente').length || 0;
    const winRate = greens + losses > 0 ? ((greens / (greens + losses)) * 100).toFixed(1) : '0.0';

    // Estimated profit calculation (flat stake R$20, odd avg 1.80)
    const oddMedia = 1.80;
    const stakeBase = 20;
    const lucroGreens = greens * stakeBase * (oddMedia - 1);
    const prejuizoLosses = losses * stakeBase;
    const lucroLiquido = lucroGreens - prejuizoLosses;
    const roi = total > 0 ? ((lucroLiquido / (total * stakeBase)) * 100).toFixed(1) : '0.0';

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
├ Odd Média: ${oddMedia.toFixed(2)}
├ Lucro Bruto: R$ ${lucroGreens.toFixed(2)}
├ Prejuízo: R$ ${prejuizoLosses.toFixed(2)}
├ <b>Lucro Líquido: R$ ${lucroLiquido.toFixed(2)}</b>
└ ROI: <b>${roi}%</b>

━━━━━━━━━━━━━━━━━━━━━━
🤖 <i>Analista Joilson — Relatório Automático</i>
    `.trim();

    const response = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
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
