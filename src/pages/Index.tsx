import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import MatchCard from '@/components/MatchCard';
import { fetchMultiDayMatches } from '@/services/footballApi';
import type { MatchData } from '@/types/match';

function isUpcoming(match: MatchData): boolean {
  if (match.isLive) return false;
  const status = String(match.status || '').toUpperCase();
  if (['1H','2H','HT','ET','BT','LIVE','FT','AET','PEN','AWD','WO','SUSP','INT','FINISHED'].includes(status)) return false;
  const kickoff = match.kickoff || match.time;
  if (!kickoff || !kickoff.includes('T')) return true;
  const timestamp = new Date(kickoff).getTime();
  return !Number.isNaN(timestamp) && timestamp >= Date.now() - 10 * 60 * 1000;
}

export default function Index() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['nexus-upcoming-matches'], queryFn: () => fetchMultiDayMatches(2), staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false });
  const matches = useMemo(() => ((data || []) as MatchData[]).filter(isUpcoming).slice(0, 100), [data]);

  return <main className="min-h-screen p-4 sm:p-6">
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Nexus 33</p><h1 className="mt-1 text-2xl font-bold">Análise de partidas</h1><p className="mt-1 text-sm text-muted-foreground">Dados reais, amostra explícita e decisão somente pelo Nexus Core.</p></div><button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-secondary disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar</button></header>
    {error && <div className="mb-5 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /> Não foi possível carregar os dados reais.</div>}
    {isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : matches.length === 0 ? <div className="rounded-2xl border border-border/50 bg-card p-8 text-center text-sm text-muted-foreground">Nenhuma partida futura disponível com dados suficientes na fonte atual.</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{matches.map((match) => <MatchCard key={match.id} match={match} />)}</div>}
    </div>
  </main>;
}
