/**
 * HYBRID STORE — persistência no Supabase (substitui localStorage para sincronia
 * entre PC e celular). Mantém compatibilidade com a API do hybridEngine.
 */
import { supabase } from '@/integrations/supabase/client';
import { getTodayInPara } from './timezone';
import type { HybridSignal, HybridTier } from './hybridEngine';

export interface HybridEntryRow {
  id: string;
  user_id: string;
  match_id: string;
  match_name: string;
  league: string | null;
  tier: HybridTier;
  minute: number;
  market: string;
  pressure: number;
  shots_on_goal: number;
  total_shots: number;
  corners: number;
  dangerous_attacks: number;
  da_estimated: boolean;
  possession: number;
  home_goals: number;
  away_goals: number;
  result: 'PENDING' | 'WIN' | 'LOSS' | 'CASHOUT';
  exit_minute: number | null;
  entry_at: string;
  resolved_at: string | null;
}

export interface HybridPerformance {
  totalEntries: number;
  wins: number;
  losses: number;
  cashouts: number;
  winrate: number;
  roi: number;
  last10: ('W' | 'L' | 'C')[];
  dayStatus: 'positivo' | 'negativo' | 'neutro';
  isBlocked: boolean;
  blockReason?: string;
  dailyCount: number;
  maxDaily: number;
}

const AVG_ODD = 1.35;
const MAX_DAILY = 5;

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function loadAllEntries(): Promise<HybridEntryRow[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('hybrid_entries')
    .select('*')
    .eq('user_id', uid)
    .order('entry_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('hybridStore.loadAllEntries:', error);
    return [];
  }
  return (data || []) as HybridEntryRow[];
}

export async function getPendingForMatch(matchId: string): Promise<HybridEntryRow | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await supabase
    .from('hybrid_entries')
    .select('*')
    .eq('user_id', uid)
    .eq('match_id', matchId)
    .eq('result', 'PENDING')
    .maybeSingle();
  return (data as HybridEntryRow) || null;
}

export async function getDailyCount(): Promise<number> {
  const uid = await getUserId();
  if (!uid) return 0;
  const today = getTodayInPara();
  const start = `${today}T00:00:00-03:00`;
  const end = `${today}T23:59:59-03:00`;
  const { count } = await supabase
    .from('hybrid_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .gte('entry_at', start)
    .lte('entry_at', end);
  return count || 0;
}

export async function getConsecutiveLosses(): Promise<number> {
  const uid = await getUserId();
  if (!uid) return 0;
  const { data } = await supabase
    .from('hybrid_entries')
    .select('result')
    .eq('user_id', uid)
    .neq('result', 'PENDING')
    .order('resolved_at', { ascending: false })
    .limit(10);
  let count = 0;
  for (const r of data || []) {
    if (r.result === 'LOSS') count++;
    else break;
  }
  return count;
}

export async function isBlocked(): Promise<{ blocked: boolean; reason: string }> {
  const [losses, daily] = await Promise.all([getConsecutiveLosses(), getDailyCount()]);
  if (losses >= 2) return { blocked: true, reason: 'STOP: 2 losses consecutivos' };
  if (daily >= MAX_DAILY) return { blocked: true, reason: `Máximo ${MAX_DAILY} entradas/dia atingido` };
  return { blocked: false, reason: '' };
}

export async function registerEntry(
  signal: HybridSignal,
  daEstimated = false,
): Promise<HybridEntryRow | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { data, error } = await supabase
    .from('hybrid_entries')
    .insert({
      user_id: uid,
      match_id: signal.matchId,
      match_name: signal.match,
      league: signal.league,
      tier: signal.tier,
      minute: signal.minute,
      market: signal.market,
      pressure: signal.pressure,
      shots_on_goal: signal.shotsOnGoal,
      total_shots: signal.totalShots,
      corners: signal.corners,
      dangerous_attacks: signal.dangerousAttacks,
      da_estimated: daEstimated,
      possession: signal.possession,
      home_goals: signal.homeGoals,
      away_goals: signal.awayGoals,
    })
    .select()
    .single();
  if (error) {
    console.error('hybridStore.registerEntry:', error);
    return null;
  }
  return data as HybridEntryRow;
}

export async function resolveEntry(
  id: string,
  result: 'WIN' | 'LOSS' | 'CASHOUT',
  exitMinute?: number,
): Promise<void> {
  const uid = await getUserId();
  if (!uid) return;
  await supabase
    .from('hybrid_entries')
    .update({ result, exit_minute: exitMinute ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', uid);
}

export async function getPerformance(): Promise<HybridPerformance> {
  const entries = await loadAllEntries();
  const resolved = entries.filter(e => e.result !== 'PENDING');
  const wins = resolved.filter(e => e.result === 'WIN').length;
  const losses = resolved.filter(e => e.result === 'LOSS').length;
  const cashouts = resolved.filter(e => e.result === 'CASHOUT').length;
  const total = resolved.length;
  const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const profit = wins * (AVG_ODD - 1) - losses * 1 - cashouts * 0.3;
  const roi = total > 0 ? Math.round((profit / total) * 100) : 0;

  const last10 = resolved.slice(0, 10).reverse().map(e =>
    e.result === 'WIN' ? 'W' as const : e.result === 'LOSS' ? 'L' as const : 'C' as const,
  );

  const today = getTodayInPara();
  const todayResolved = resolved.filter(e => (e.resolved_at || e.entry_at).startsWith(today));
  const dayProfit = todayResolved.reduce((acc, e) => {
    if (e.result === 'WIN') return acc + (AVG_ODD - 1);
    if (e.result === 'LOSS') return acc - 1;
    return acc - 0.3;
  }, 0);

  const [{ blocked, reason }, dailyCount] = await Promise.all([isBlocked(), getDailyCount()]);

  return {
    totalEntries: total, wins, losses, cashouts, winrate, roi, last10,
    dayStatus: dayProfit > 0 ? 'positivo' : dayProfit < 0 ? 'negativo' : 'neutro',
    isBlocked: blocked, blockReason: reason || undefined,
    dailyCount, maxDaily: MAX_DAILY,
  };
}
