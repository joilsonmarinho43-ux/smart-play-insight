// =============================================================
// signal-context-tracker — observa sinais pós-emissão.
// Lê cache_api (live_all) — NÃO consome API externa.
// Roda via cron a cada 3 min.
// Não altera nenhum engine. Apenas registra comportamento.
// =============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';


import { corsHeaders } from '../_shared/cors.ts';
// ---- pressão simplificada (não substitui pressureEngine) ----
function pressureSide(s: any): number {
  if (!s) return 0;
  const sot = Number(s.shots_on_goal ?? s.shotsOnGoal ?? 0);
  const da = Number(s.dangerous_attacks ?? s.dangerousAttacks ?? 0);
  const cor = Number(s.corners ?? 0);
  const ts = Number(s.total_shots ?? s.totalShots ?? 0);
  // weights pragmáticos, apenas para tracking interno
  return sot * 4 + da * 0.55 + cor * 2 + ts * 0.8;
}

function classify(t: any): string {
  const snaps: any[] = t.snapshots ?? [];
  const n = snaps.length;
  if (n < 2) return 'insuficiente';

  const entryP = Number(t.entry_pressure ?? 0);
  const avgP = Number(t.avg_pressure ?? 0);
  const minP = Number(t.min_pressure ?? 0);
  const dropPct = entryP > 0 ? (entryP - minP) / entryP : 0;
  const std = Number(t.pressure_std ?? 0);
  const cv = avgP > 0 ? std / avgP : 0;
  const lastP = Number(t.last_pressure ?? 0);

  const win = t.result === 'WIN' || t.result === 'GREEN';
  const loss = t.result === 'LOSS' || t.result === 'RED';
  const ttgMin = t.time_to_goal_sec != null ? Number(t.time_to_goal_sec) / 60 : null;
  const goalsAfter = Number(t.goals_after ?? 0);

  // Ordem de prioridade
  if (win && ttgMin != null && ttgMin <= 10 && t.entry_minute <= 35) return 'explosivo';
  if (loss && dropPct > 0.4 && entryP > 0 && n >= 3) return 'fake_pressure';
  if (!win && goalsAfter === 0 && lastP < entryP * 0.5 && n >= 3) return 'dead_after_entry';
  if (win && ttgMin != null && ttgMin > 25) return 'tardio';
  if (t.entry_minute < 20 && (loss || (goalsAfter === 0 && n >= 4))) return 'precoce';
  if (cv > 0.35) return 'alta_volatilidade';
  if (entryP > 0 && avgP >= entryP * 0.8 && dropPct < 0.25) return 'pressao_sustentavel';
  if (win && goalsAfter >= 1) return 'consistente';
  return 'neutro';
}

function recomputeAggregates(snaps: any[]): any {
  if (snaps.length === 0) return {};
  const ps = snaps.map((s) => Number(s.pressure ?? 0));
  const sum = ps.reduce((a, b) => a + b, 0);
  const avg = sum / ps.length;
  const peak = Math.max(...ps);
  const min = Math.min(...ps);
  const variance = ps.reduce((a, b) => a + (b - avg) ** 2, 0) / ps.length;
  const std = Math.sqrt(variance);
  return {
    peak_pressure: +peak.toFixed(2),
    min_pressure: +min.toFixed(2),
    avg_pressure: +avg.toFixed(2),
    pressure_std: +std.toFixed(2),
    pressure_drop_pct: snaps[0].pressure > 0
      ? +((snaps[0].pressure - min) / snaps[0].pressure).toFixed(3)
      : 0,
    last_pressure: +ps[ps.length - 1].toFixed(2),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1) Sinais a observar: success=true, criados nas últimas 130min,
    //    ainda não finalizados no tracking.
    const sinceIso = new Date(Date.now() - 130 * 60 * 1000).toISOString();
    const { data: signals, error: sErr } = await sb
      .from('telegram_signals')
      .select('id, match_id, match_name, league, market, minute, created_at, result, status, settled_at')
      .eq('success', true)
      .gte('created_at', sinceIso)
      .not('match_id', 'is', null);
    if (sErr) throw sErr;

    if (!signals?.length) {
      return new Response(JSON.stringify({ ok: true, tracked: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2) Snapshot live do cache (sem chamar API externa)
    const { data: liveRow } = await sb
      .from('cache_api')
      .select('dados_json, ultima_atualizacao')
      .eq('cache_key', 'live_all')
      .maybeSingle();
    const liveMatches: any[] = liveRow?.dados_json?.matches ?? [];
    const liveById = new Map<string, any>();
    for (const m of liveMatches) liveById.set(String(m.id), m);

    // 3) Tracking existente
    const ids = signals.map((s) => s.id);
    const { data: existing } = await sb
      .from('signal_tracking')
      .select('*')
      .in('signal_id', ids);
    const trackById = new Map<string, any>();
    for (const t of existing ?? []) trackById.set(t.signal_id, t);

    const upserts: any[] = [];
    const nowIso = new Date().toISOString();
    let processed = 0, finalized = 0;

    for (const sig of signals) {
      const existingT = trackById.get(sig.id);
      if (existingT?.finalized) continue;

      const live = liveById.get(String(sig.match_id));
      const elapsedMin = (Date.now() - new Date(sig.created_at).getTime()) / 60000;
      const verdict = String(sig.result ?? sig.status ?? '').toUpperCase();
      const isResolved = ['WIN', 'LOSS', 'VOID', 'GREEN', 'RED'].includes(verdict);
      const tooOld = elapsedMin > 125;

      // === Snapshot do estado atual ===
      let snapshot: any = null;
      if (live) {
        const stats = live.stats ?? {};
        const home = stats.home ?? {};
        const away = stats.away ?? {};
        const goalsHome = Number(live.goals?.home ?? 0);
        const goalsAway = Number(live.goals?.away ?? 0);
        const minuteNow = Number(live.fixture?.status?.elapsed ?? sig.minute);
        const ph = pressureSide(home);
        const pa = pressureSide(away);
        snapshot = {
          t: nowIso,
          minute: minuteNow,
          score_home: goalsHome,
          score_away: goalsAway,
          pressure_home: +ph.toFixed(2),
          pressure_away: +pa.toFixed(2),
          pressure: +(ph + pa).toFixed(2), // total como proxy
          sot_home: Number(home.shots_on_goal ?? 0),
          sot_away: Number(away.shots_on_goal ?? 0),
          da_home: Number(home.dangerous_attacks ?? 0),
          da_away: Number(away.dangerous_attacks ?? 0),
          corners_home: Number(home.corners ?? 0),
          corners_away: Number(away.corners ?? 0),
        };
      }

      const baseSnaps: any[] = existingT?.snapshots ?? [];
      // dedupe: ignora se mesma minute do último
      const lastSnap = baseSnaps[baseSnaps.length - 1];
      const newSnaps = snapshot && (!lastSnap || lastSnap.minute !== snapshot.minute)
        ? [...baseSnaps, snapshot]
        : baseSnaps;

      // Detecta primeiro gol após entrada
      let firstGoalMinute: number | null = existingT?.first_goal_minute ?? null;
      let timeToGoalSec: number | null = existingT?.time_to_goal_sec ?? null;
      let goalsAfter = existingT?.goals_after ?? 0;
      if (newSnaps.length >= 1) {
        const firstSnap = newSnaps[0];
        const last = newSnaps[newSnaps.length - 1];
        const baseGoals = (firstSnap.score_home ?? 0) + (firstSnap.score_away ?? 0);
        const curGoals = (last.score_home ?? 0) + (last.score_away ?? 0);
        goalsAfter = Math.max(0, curGoals - baseGoals);
        if (firstGoalMinute == null && goalsAfter > 0) {
          // encontra a primeira snap onde houve gol
          for (const s of newSnaps) {
            const g = (s.score_home ?? 0) + (s.score_away ?? 0);
            if (g > baseGoals) {
              firstGoalMinute = s.minute;
              timeToGoalSec = Math.round((new Date(s.t).getTime() - new Date(sig.created_at).getTime()) / 1000);
              break;
            }
          }
        }
      }

      const agg = recomputeAggregates(newSnaps);
      const entryPressure = existingT?.entry_pressure ?? (newSnaps[0]?.pressure ?? null);

      const willFinalize = !!isResolved || tooOld;
      const payload: any = {
        signal_id: sig.id,
        match_id: sig.match_id,
        match_name: sig.match_name,
        league: sig.league,
        market: sig.market,
        entry_minute: sig.minute,
        entry_at: existingT?.entry_at ?? sig.created_at,
        last_seen_at: nowIso,
        snapshot_count: newSnaps.length,
        snapshots: newSnaps.slice(-30), // mantém últimos 30
        entry_pressure: entryPressure,
        goals_after: goalsAfter,
        first_goal_minute: firstGoalMinute,
        time_to_goal_sec: timeToGoalSec,
        result: verdict || null,
        finalized: willFinalize,
        finalized_at: willFinalize ? nowIso : null,
        ...agg,
      };
      payload.behavior_class = willFinalize ? classify(payload) : null;

      upserts.push(payload);
      processed++;
      if (willFinalize) finalized++;
    }

    if (upserts.length > 0) {
      const { error: uErr } = await sb
        .from('signal_tracking')
        .upsert(upserts, { onConflict: 'signal_id' });
      if (uErr) throw uErr;
    }

    return new Response(
      JSON.stringify({ ok: true, processed, finalized, signals: signals.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[signal-context-tracker]', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
