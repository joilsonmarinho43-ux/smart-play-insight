import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Clock, Database, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { fetchLiveMatches, fetchMultiDayMatches, fetchMatchStats } from '@/services/footballApi';
import type { MatchData } from '@/types/match';
import { useTeamForm, mergeFormIntoMatch } from '@/hooks/useTeamForm';

const MatchDetails = () => {
  const { id } = useParams<{ id: string }>();
  const { data: live, isLoading: loadingLive } = useQuery({ queryKey: ['liveMatches'], queryFn: fetchLiveMatches, staleTime: 120_000, refetchOnWindowFocus: false });
  const { data: multi, isLoading: loadingMulti } = useQuery({ queryKey: ['multi-day-matches-detail'], queryFn: () => fetchMultiDayMatches(6), staleTime: 120_000, refetchOnWindowFocus: false });
  const match = useMemo(() => { const sid = String(id || ''); const all = [...(live || []), ...(multi || [])] as MatchData[]; return all.find((item) => String(item.id) === sid) || null; }, [live, multi, id]);

  const fixtureId = Number((match as any)?.providerFixtureId ?? (match as any)?.fixture?.id ?? (String((match as any)?.id || '').match(/(\d+)$/)?.[1] ?? NaN));
  const { data: observedStats, isLoading: loadingStats } = useQuery({
    queryKey: ['match-stats', fixtureId],
    queryFn: () => fetchMatchStats(fixtureId),
    enabled: Number.isFinite(fixtureId) && fixtureId > 0,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  const { data: form } = useTeamForm(match);
  const enrichedMatch = useMemo(() => mergeFormIntoMatch(match as MatchData, form), [match, form]);

  if (loadingLive || loadingMulti) return <div className="p-6 text-sm text-muted-foreground">Carregando dados do jogo…</div>;
  if (!match) return <div className="p-6"><Link to="/" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4" /> Voltar</Link><p className="mt-6 text-sm text-muted-foreground">Jogo não encontrado na fonte de dados atual.</p></div>;

  const viewMatch = enrichedMatch as MatchData;

  const metrics = viewMatch.metrics;
  const sample = viewMatch.sampleSize;
  const model = viewMatch.modelData;
  const sufficientSample = !!sample && Math.min(sample.homeGames, sample.awayGames) >= 3;
  const predictions = viewMatch.predictions;
  const coreReady = predictions?.probabilitySource === 'MODEL_ESTIMATE' && (predictions.calibrationStatus === 'CALIBRATED' || predictions.calibrationStatus === 'MODEL_VALIDATED') && [predictions.homeWin, predictions.draw, predictions.awayWin].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100);

  return <div className="min-h-screen bg-background p-4 sm:p-6 max-w-3xl mx-auto">
    <Link to="/" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
    <header className="mt-5 rounded-2xl border border-border/50 bg-card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{viewMatch.league}</p>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><h1 className="text-right text-lg font-bold break-words">{viewMatch.homeTeam}</h1><span className="rounded-lg bg-secondary px-3 py-1 text-xs font-semibold">{viewMatch.isLive && viewMatch.liveScore ? `${viewMatch.liveScore.home}–${viewMatch.liveScore.away}` : 'VS'}</span><h1 className="text-lg font-bold break-words">{viewMatch.awayTeam}</h1></div>
      <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {viewMatch.time}{viewMatch.isLive ? ` · AO VIVO${viewMatch.minute != null ? ` · ${viewMatch.minute}'` : ''}` : ''}</div>
    </header>

    <section className={`mt-4 rounded-2xl border p-5 ${coreReady ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-primary/20 bg-primary/5'}`}>
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Nexus Core</h2>{coreReady && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> {predictions?.calibrationStatus === 'CALIBRATED' ? 'Calibrado' : 'Validado pelo modelo'}</span>}</div>
      {coreReady ? <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-background/40 p-3"><span className="text-muted-foreground">Casa</span><div className="mt-1 font-bold tabular-nums">{predictions?.homeWin}%</div></div><div className="rounded-lg bg-background/40 p-3"><span className="text-muted-foreground">Empate</span><div className="mt-1 font-bold tabular-nums">{predictions?.draw}%</div></div><div className="rounded-lg bg-background/40 p-3"><span className="text-muted-foreground">Fora</span><div className="mt-1 font-bold tabular-nums">{predictions?.awayWin}%</div></div></div> : <><p className="mt-2 text-sm font-semibold text-amber-300">Nenhuma probabilidade oficial liberada</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">O Nexus Core só publica probabilidades quando a origem do modelo e a calibração estão explicitamente validadas. O restante permanece como informação observada.</p></>}
    </section>

    <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" /> Estatísticas completas</div>{loadingStats && <span className="text-[10px] text-muted-foreground">Atualizando…</span>}</div>
      {(() => {
        const s:any = observedStats;
        const value=(key:string, side:0|1) => { const v=s?.[side===0?'home':'away']?.[key]; if(v!==null&&v!==undefined&&v!=='') return v; const m:any=metrics; const map:any={possession:'possession',totalShots:'totalShots',shotsOnTarget:'shotsOnTarget',bigChances:'bigChances',corners:'corners',offsides:'offsides',fouls:'fouls',yellowCards:'yellowCards',xG:'xG'}; return m?.[map[key]]?.[side] ?? '—'; };
        const rows=[['Gols','goals'],['Posse','possession'],['xG','xG'],['Finalizações','totalShots'],['No alvo','shotsOnGoal'],['Fora do alvo','shotsOffGoal'],['Grandes chances','bigChances'],['Escanteios','corners'],['Impedimentos','offsides'],['Faltas','fouls'],['Cartões amarelos','yellowCards'],['Cartões vermelhos','redCards']];
        const goals=[(match as any)?.goals?.home,(match as any)?.goals?.away];
        return <div className="overflow-x-auto"><div className="min-w-[300px] text-xs"><div className="grid grid-cols-[1fr_72px_72px] border-b border-border pb-2 font-semibold"><span>Indicador</span><span className="text-center">{viewMatch.homeTeam}</span><span className="text-center">{viewMatch.awayTeam}</span></div>{rows.map(([label,key])=><div key={key} className="grid grid-cols-[1fr_72px_72px] border-b border-border/40 py-2"><span className="text-muted-foreground">{label}</span><span className="text-center font-medium tabular-nums">{key==='goals'?(goals[0]??'—'):value(key,0)}{key==='possession'&&value(key,0)!=='—'?'%':''}</span><span className="text-center font-medium tabular-nums">{key==='goals'?(goals[1]??'—'):value(key,1)}{key==='possession'&&value(key,1)!=='—'?'%':''}</span></div>)}</div></div>;
      })()}
      {!loadingStats && !observedStats && !metrics && <p className="mt-3 text-xs text-muted-foreground">Nenhuma estatística observada disponível para este jogo.</p>}
    </section>

    <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" /> Qualidade da amostra</div>{sample ? <p className="text-xs text-muted-foreground">Casa: {sample.homeGames} jogos · Fora: {sample.awayGames} jogos · com estatísticas: {sample.homeWithStats}/{sample.awayWithStats}</p> : <p className="text-xs text-destructive">Amostra não informada.</p>}{!sufficientSample && <div className="mt-3 flex items-center gap-2 text-xs text-amber-400"><ShieldAlert className="h-4 w-4" /> A amostra atual não é suficiente para uma decisão estatística forte.</div>}</section>

    <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5"><h2 className="text-sm font-semibold">Modelo estatístico</h2>{model && sufficientSample ? <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div>Gols médios casa: <b>{model.homeGoalsAvg ?? '—'}</b></div><div>Gols médios fora: <b>{model.awayGoalsAvg ?? '—'}</b></div><div>Escanteios casa: <b>{model.homeCornersAvg ?? '—'}</b></div><div>Escanteios fora: <b>{model.awayCornersAvg ?? '—'}</b></div></div> : <p className="mt-2 text-xs text-muted-foreground">Modelo não liberado para decisão com a evidência disponível.</p>}<p className="mt-3 text-[10px] text-muted-foreground">Grandes chances são uma estatística observada. Não são convertidas em xG.</p></section>
  </div>;
};

export default MatchDetails;
