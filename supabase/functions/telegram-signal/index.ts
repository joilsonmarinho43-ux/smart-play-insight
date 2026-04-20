const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

interface SignalPayload {
  match: string;
  market: string;
  confidence: number;
  filtersValidated: string;
  sensitivity: string;
  minute: number;
  score: string;
  poisson?: string;
  oddMin?: string;
  janela?: string;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
    if (!TELEGRAM_API_KEY) throw new Error('TELEGRAM_API_KEY not configured');

    const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!CHAT_ID) throw new Error('TELEGRAM_CHAT_ID not configured');

    const payload: SignalPayload = await req.json();

    // Build message — short summary + full details
    const emoji = payload.confidence >= 80 ? '🔥' : payload.confidence >= 70 ? '⚡' : '📊';
    const sensitivityEmoji = { conservador: '🛡️', moderado: '⚖️', agressivo: '🔥' }[payload.sensitivity] || '⚖️';

    const shortMsg = `${emoji} <b>${payload.match}</b> • ${payload.market} • ${payload.confidence}%`;

    const fullMsg = [
      `━━━━━━━━━━━━━━━━━━━━━`,
      `${emoji} <b>SINAL CONFIRMADO</b>`,
      `━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `⚽ <b>${payload.match}</b>`,
      `⏱ Minuto: <b>${payload.minute}'</b>`,
      `📈 Mercado: <b>${payload.market}</b>`,
      `🎯 Confiança: <b>${payload.confidence}%</b>`,
      `📊 Placar: <b>${payload.score}</b>`,
      `✅ Filtros: <b>${payload.filtersValidated}</b>`,
      `${sensitivityEmoji} Modo: <b>${payload.sensitivity}</b>`,
      payload.poisson ? `🧮 Poisson: <b>${payload.poisson}</b>` : null,
      payload.oddMin ? `💰 Odd mín: <b>${payload.oddMin}</b>` : null,
      payload.janela ? `🕐 Janela: <b>${payload.janela}</b>` : null,
      payload.reason ? `\n💡 <i>${payload.reason}</i>` : null,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━`,
      `🤖 <i>Analista Joilson • Live Trader PRO</i>`,
    ].filter(Boolean).join('\n');

    const text = `${shortMsg}\n\n${fullMsg}`;

    const response = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Telegram API failed [${response.status}]: ${JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify({ success: true, message_id: data.result?.message_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Telegram signal error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
