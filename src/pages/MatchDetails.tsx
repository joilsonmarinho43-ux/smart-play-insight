import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Clock, Database, ShieldAlert } from 'lucide-react';
import { fetchLiveMatches, fetchMultiDayMatches } from '@/services/footballApi';
import type { MatchData } from '@/types/match';

const MatchDetails = () => {
  const { id } = useParams<{ id: string }>();
  const { data: live, isLoading: loadingLive } = useQuery({ queryKey: ['liveMatches'], queryFn: fetchLiveMatches, staleTime: 120_000, refetchOnWindowFocus: false });
  const { data: multi, isLoading: loadingMulti } = useQuery({ queryKey: ['multi-day-matches-detail'], queryFn: () => fetchMultiDayMatches(6), staleTime: 600_000, refetchOnWindowFocus: false });

  const match = useMemo(() => {
    const sid = String(id || '');
    const all = [...(live || []), ...(multi || [])] as MatchData[];
    return all.find((item) => String(item.id) === sid) || null;
  }, [live, multi, id]);

  if (loadingLive || loadingMulti) return <div className="p-6 text-sm text-muted-foreground">Carregando dados do jogo…</div>;
  if (!match) return <div className="p-6"><Link to="/" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4" /> Voltar</Link><p className="mt-6 text-sm text-muted-foreground">Jogo não encontrado na fonte de dados atual.</p></div>;

  const metrics = match.metrics;
  const sample = match.sampleSize;
  const model = match.modelData;
  const sufficientSample = !!sample && Math.min(sample.homeGames, sample.awayGames) >= 3;

  return <div className="min-h-screen bg-background p-4 sm:p-6 max-w-3xl mx-auto">
    <Link to="/" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
    <header className="mt-5 rounded-2xl border border-border/50 bg-card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{match.league}</p>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><h1 className="text-right text-lg font-bold">{match.homeTeam}</h1><span className="rounded-lg bg-secondary px-3 py-1 text-xs font-semibold">{match.isLive && match.liveScore ? `${match.liveScore.home}–${match.liveScore.away}` : 'VS'}</span><h1 className="text-lg font-bold">{match.awayTeam}</h1></div>
      <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {match.time}{match.isLive ? ` · AO VIVO${match.minute != null ? ` · ${match.minute}'` : ''}` : ''}</div>
    </header>

    <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" /> Dados observados</div>
      {metrics ? <div className="grid grid-cols-2 gap-2 text-xs"><div>Posse: {metrics.possession?.[0] ?? '—'}% / {metrics.possession?.[1] ?? '—'}%</div><div>Finalizações: {metrics.totalShots?.[0] ?? '—'} / {metrics.totalShots?.[1] ?? '—'}</div><div>No alvo: {metrics.shotsOnTarget?.[0] ?? '—'} / {metrics.shotsOnTarget?.[1] ?? '—'}</div><div>Grandes chances: {metrics.bigChances?.[0] ?? '—'} / {metrics.bigChances?.[1] ?? '—'}</div><div>Escanteios: {metrics.corners?.[0] ?? '—'} / {metrics.corners?.[1] ?? '—'}</div><div>Cartões: {metrics.yellowCards?.[0] ?? '—'} / {metrics.yellowCards?.[1] ?? '—'}</div></div> : <p className="text-xs text-muted-foreground">Estatísticas observadas não disponíveis.</p>}
    </section>

    <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" /> Qualidade da amostra</div>
      {sample ? <p className="text-xs text-muted-foreground">Casa: {sample.homeGames} jogos · Fora: {sample.awayGames} jogos · com estatísticas: {sample.homeWithStats}/{sample.awayWithStats}</p> : <p className="text-xs text-destructive">Amostra não informada.</p>}
      {!sufficientSample && <div className="mt-3 flex items-center gap-2 text-xs text-amber-400"><ShieldAlert className="h-4 w-4" /> A amostra atual não é suficiente para uma decisão estatística forte.</div>}
    </section>

    <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
      <h2 className="text-sm font-semibold">Modelo</h2>
      {model && sufficientSample ? <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div>Gols médios casa: <b>{model.homeGoalsAvg ?? '—'}</b></div><div>Gols médios fora: <b>{model.awayGoalsAvg ?? '—'}</b></div><div>Escanteios casa: <b>{model.homeCornersAvg ?? '—'}</b></div><div>Escanteios fora: <b>{model.awayCornersAvg ?? '—'}</b></div></div> : <p className="mt-2 text-xs text-muted-foreground">Modelo não liberado para decisão com a evidência disponível.</p>}
      <p className="mt-3 text-[10px] text-muted-foreground">Grandes chances são uma estatística observada. Não são convertidas em xG. Probabilidade oficial só pode vir do Nexus Core.</p>
    </section>
  </div>;
};

export default MatchDetails;
