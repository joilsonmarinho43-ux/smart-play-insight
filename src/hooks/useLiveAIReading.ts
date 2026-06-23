import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LiveAIReadingResult {
  text: string;
  source: 'groq' | 'gemini';
}

export function useLiveAIReading() {
  const [data, setData] = useState<LiveAIReadingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (match: any) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const payload = {
        mode: 'live' as const,
        match: `${match.homeTeam} x ${match.awayTeam}`,
        league: match.league || undefined,
        minute: match.minute || undefined,
        score: match.liveScore
          ? `${match.liveScore.home ?? 0} x ${match.liveScore.away ?? 0}`
          : undefined,
        pressure: match.liveStats?.pressureIndex
          ? { home: match.liveStats.pressureIndex[0] ?? 0, away: match.liveStats.pressureIndex[1] ?? 0 }
          : undefined,
        dangerousAttacks: match.liveStats?.dangerousAttacks
          ? { home: match.liveStats.dangerousAttacks[0] ?? 0, away: match.liveStats.dangerousAttacks[1] ?? 0 }
          : undefined,
        shotsOnGoal: match.liveStats?.shotsOnGoal
          ? { home: match.liveStats.shotsOnGoal[0] ?? 0, away: match.liveStats.shotsOnGoal[1] ?? 0 }
          : undefined,
        corners: match.liveStats?.corners
          ? { home: match.liveStats.corners[0] ?? 0, away: match.liveStats.corners[1] ?? 0 }
          : undefined,
        possession: match.liveStats?.possession
          ? { home: match.liveStats.possession[0] ?? 0, away: match.liveStats.possession[1] ?? 0 }
          : undefined,
      };
      const { data: res, error: err } = await supabase.functions.invoke('ai-signal-analyst', { body: payload });
      if (err) throw err;
      if (!res?.ok) throw new Error(res?.error || 'IA indisponível');
      setData({ text: res.text, source: res.source });
    } catch (e: any) {
      setError(e?.message || 'Falha ao gerar leitura');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, generate };
}
