import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Parse "1 x 0" -> { home: 1, away: 0, total: 1 }
function parseScore(score: string | null): { total: number } | null {
  if (!score) return null;
  const m = String(score).match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (!m) return null;
  return { total: parseInt(m[1], 10) + parseInt(m[2], 10) };
}

// Normalize market for grouping (Over 1.5 == Over 1.5 Gols)
function normMarket(m: string): string {
  const t = (m || '').trim();
  const match = t.match(/^Over\s+(\d+\.\d+)(\s+HT)?(\s+Gols?)?$/i);
  if (match) return `Over ${match[1]}${match[2] ? ' HT' : ''}`;
  return t;
}

interface Combo { zero: number; one: number; }

interface Stats {
  combo: Combo;
  total: number;
  green: number;
  loss: number;
  pending: number;
  winRate: number;
  // breakdown by entry score
  byZero: { total: number; green: number; loss: number; winRate: number };
  byOne: { total: number; green: number; loss: number; winRate: number };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const days = Number(body.days ?? 14);
    const market = String(body.market ?? 'Over 1.5'); // base market to test
    const sensitivity = body.sensitivity ?? 'moderado'; // SEMI = moderado
    const zeroOptions: number[] = body.zeroOptions ?? [25, 30, 35, 40, 45];
    const oneOptions: number[] = body.oneOptions ?? [40, 45, 50, 55, 60];

    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const { data, error } = await supabase
      .from('telegram_signals')
      .select('market, minute, score, status, sensitivity, success, created_at')
      .gte('created_at', since)
      .eq('success', true)
      .in('status', ['green', 'loss']);

    if (error) throw error;

    // Filter to SEMI signals on the target market
    const targetMarket = normMarket(market);
    const rows = (data || []).filter((r: any) => {
      if (normMarket(r.market) !== targetMarket) return false;
      if (sensitivity && r.sensitivity !== sensitivity) return false;
      const s = parseScore(r.score);
      if (!s) return false;
      // Only consider entries 0x0 or single-goal (since SEMI accepts these)
      return s.total <= 1;
    });

    const totalAvailable = rows.length;

    // Run grid: for each (zeroMax, oneMax), keep only signals that would have been allowed
    const results: Stats[] = [];
    for (const zero of zeroOptions) {
      for (const one of oneOptions) {
        let total = 0, green = 0, loss = 0, pending = 0;
        let z_total = 0, z_green = 0, z_loss = 0;
        let o_total = 0, o_green = 0, o_loss = 0;

        for (const r of rows) {
          const s = parseScore(r.score)!;
          const min = r.minute || 0;
          const allowed =
            (s.total === 0 && min >= 5 && min <= zero) ||
            (s.total === 1 && min >= 5 && min <= one);
          if (!allowed) continue;
          total++;
          if (r.status === 'green') green++;
          else if (r.status === 'loss') loss++;
          else pending++;

          if (s.total === 0) {
            z_total++;
            if (r.status === 'green') z_green++;
            else if (r.status === 'loss') z_loss++;
          } else {
            o_total++;
            if (r.status === 'green') o_green++;
            else if (r.status === 'loss') o_loss++;
          }
        }
        const resolved = green + loss;
        const winRate = resolved > 0 ? (green / resolved) * 100 : 0;
        results.push({
          combo: { zero, one },
          total, green, loss, pending,
          winRate: Math.round(winRate * 10) / 10,
          byZero: {
            total: z_total, green: z_green, loss: z_loss,
            winRate: (z_green + z_loss) > 0 ? Math.round((z_green / (z_green + z_loss)) * 1000) / 10 : 0,
          },
          byOne: {
            total: o_total, green: o_green, loss: o_loss,
            winRate: (o_green + o_loss) > 0 ? Math.round((o_green / (o_green + o_loss)) * 1000) / 10 : 0,
          },
        });
      }
    }

    // Rank by winRate (with min sample size 5 to avoid noise), tie-break by total
    const ranked = [...results].sort((a, b) => {
      const aQual = (a.green + a.loss) >= 5;
      const bQual = (b.green + b.loss) >= 5;
      if (aQual !== bQual) return aQual ? -1 : 1;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.total - a.total;
    });

    return new Response(
      JSON.stringify({
        success: true,
        params: { days, market: targetMarket, sensitivity, zeroOptions, oneOptions },
        totalAvailable,
        sampleSizeNote: 'Combos com <5 sinais resolvidos são despriorizados no ranking',
        best: ranked[0] ?? null,
        top5: ranked.slice(0, 5),
        all: results,
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[SEMI-SIM] Erro:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
