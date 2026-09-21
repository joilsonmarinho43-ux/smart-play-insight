import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Crown, Crosshair, Loader2, RefreshCw, Target, Trophy } from 'lucide-react';
import { fetchMultiDayMatches } from '@/services/footballApi';
import { supabase } from '@/integrations/supabase/client';
import { mergeFormIntoMatch } from '@/hooks/useTeamForm';
import { analyzeMarkets, exactScoreDistribution } from '@/lib/matchAnalysis';
import type { MatchData } from '@/types/match';

const shell = 'min-h-screen text-white pb-10 font-sans';
const card = 'rounded-2xl border border-white/10 bg-black/25 backdrop-blur-sm';
const started = new Set(['1H','2H','HT','ET','BT','P','LIVE','FT','AET','PEN','AWD','WO','SUSP','INT','IN_PLAY','PAUSED','FINISHED','AWARDED']);

function isUpcoming(m: MatchData) {
  if (m.isLive) return false;
  const status = String((m as any).fixture?.status?.short ?? m.status ?? '').toUpperCase();
  if (started.has(status)) return false;
  const iso = m.kickoff || (m as any).fixture?.date;
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) || t >= Date.now() - 10 * 60 * 1000;
}

function useMatches() {
  const query = useQuery({
    queryKey: ['nexus-analytical-tools-matches-v2'],
    queryFn: async () => {
      const raw = (await fetchMultiDayMatches(6)).filter(isUpcoming);
      const ordered = [...raw].sort((a,b) => {
        const at = new Date(a.kickoff || a.time || 0).getTime();
        const bt = new Date(b.kickoff || b.time || 0).getTime();
        return (Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bt) ? bt : Number.MAX_SAFE_INTEGER);
      });

      // Analytical screens previously consumed raw fixtures only. Most free
      // fixture sources do not carry the historical sample required by the
      // quantitative engine. Enrich only the first 8 candidates in one
      // batched edge call; this avoids an N+1 request storm while preserving
      // the existing screen/UI.
      const needsForm = (m: MatchData) => {
        const md:any = m.modelData || {};
        const s:any = m.sampleSize || {};
        const validMetric = (v:any) => typeof v === 'number' && Number.isFinite(v);
        return !(Number(s.homeGames) >= 3 && Number(s.awayGames) >= 3 &&
          validMetric(md.homeGoalsAvg) &&
          validMetric(md.awayGoalsAvg) &&
          validMetric(md.homeGoalsAgainstAvg) &&
          validMetric(md.awayGoalsAgainstAvg));
      };
      const targets = ordered.filter(needsForm).slice(0, 8);
      if (!targets.length) return ordered;

      try {
        const { data, error } = await supabase.functions.invoke('team-form', {
          body: { matches: targets.map(m => ({ id: String(m.id), home: m.homeTeam, away: m.awayTeam })) },
        });
        if (error || !data?.ok || !Array.isArray(data?.matches)) return ordered;

        const forms = new Map<string, any>(
          data.matches
            .filter((x:any) => x?.id)
            .map((x:any) => [String(x.id), x])
        );
        return ordered.map(m => {
          const form = forms.get(String(m.id));
          return form?.home && form?.away
            ? mergeFormIntoMatch(m, { ok: true, home: form.home, away: form.away })
            : m;
        });
      } catch {
        return ordered;
      }
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });
  const data = useMemo(() => ((query.data || []) as MatchData[]).filter(isUpcoming), [query.data]);
  return { ...query, data };
}
function MatchName({ match }: { match: any }) { return <>{match.homeTeam || match.teams?.home?.name || 'Casa'} <span className="text-orange-500/60">vs</span> {match.awayTeam || match.teams?.away?.name || 'Fora'}</>; }
function validatedMarkets(match: MatchData) {
  return analyzeMarkets(match).filter(m =>
    m.probabilitySource === 'MODEL_ESTIMATE' &&
    (m.calibrationStatus === 'MODEL_VALIDATED' || m.calibrationStatus === 'CALIBRATED') &&
    Number.isFinite(m.probability) && m.probability >= 75
  );
}
function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function modelReady(match: MatchData) {
  const s = match.sampleSize;
  const md = match.modelData;
  return hasFiniteNumber(s?.homeGames) &&
    hasFiniteNumber(s?.awayGames) &&
    s.homeGames >= 3 &&
    s.awayGames >= 3 &&
    hasFiniteNumber(md?.homeGoalsAvg) &&
    hasFiniteNumber(md?.awayGoalsAvg) &&
    hasFiniteNumber(md?.homeGoalsAgainstAvg) &&
    hasFiniteNumber(md?.awayGoalsAgainstAvg);
}
function Loading() { return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin text-orange-400" />Carregando jogos...</div>; }
function Empty({ text = 'Nenhum jogo futuro disponível.' }: { text?: string }) { return <div className="py-16 text-center text-gray-500">{text}</div>; }
function Header({ icon, title, subtitle, onRefresh }: any) { return <header className="flex items-center justify-between mb-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-white/5 p-3">{icon}</div><div><h1 className="text-2xl font-black">{title}</h1><p className="text-xs text-gray-500">{subtitle}</p></div></div><button onClick={onRefresh} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"><RefreshCw className="inline h-3.5 w-3.5 mr-1" />Atualizar</button></header>; }

export function BingoVIPPro() {
  const { data, isLoading, isError, refetch } = useMatches();
  const rows = useMemo(() => data.map(match => ({ match, markets: validatedMarkets(match).filter(x => x.probability >= 70 && x.probability > 0).sort((a,b) => b.probability-a.probability).slice(0,3) })).filter(x => x.markets.length).sort((a,b) => b.markets[0].probability-a.markets[0].probability).slice(0,12), [data]);
  return <div className={shell}><main className="container max-w-6xl mx-auto px-4 py-6"><Header icon={<Trophy className="h-6 w-6 text-orange-400" />} title="BINGO VIP PRO" subtitle="Seleção analítica de múltiplos mercados • NEXUS Core" onRefresh={refetch} />{isError&&<div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><AlertTriangle className="inline h-4 w-4 mr-2"/>Não foi possível carregar os jogos.</div>}{isLoading?<Loading/>:rows.length===0?<Empty text="Nenhum mercado elegível com os dados atuais."/>:<div className="grid gap-3">{rows.map(({match,markets})=><section key={String(match.id||(match as any).fixture?.id)} className={card+' p-4'}><div className="mb-3 flex items-center justify-between"><div className="font-bold text-sm"><MatchName match={match}/></div><span className="text-[10px] text-gray-500">{match.league}</span></div><div className="grid gap-2 md:grid-cols-3">{markets.map(m=><div key={m.market} className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3"><div className="text-xs text-gray-300">{m.market}</div><div className="mt-1 text-xl font-black text-emerald-400">{m.probability}%</div><div className="text-[10px] text-gray-500">{m.risk} • {m.probabilitySource}</div></div>)}</div></section>)}</div>}</main></div>;
}

export function ElitePerformance() {
  const { data, isLoading, refetch } = useMatches();
  const rows = useMemo(() => data.map(m => { const markets=validatedMarkets(m); const best=(category:string)=>Math.max(0,...markets.filter(x=>x.category===category).map(x=>x.probability)); const goals=best('goals'), corners=best('corners'), cards=best('cards'); const values=[goals,corners,cards].filter(v=>v>0); return {m,goals,corners,cards,score:values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):0}; }).filter(x=>x.score>=75).sort((a,b)=>b.score-a.score).slice(0,20),[data]);
  return <div className={shell}><main className="container max-w-6xl mx-auto px-4 py-6"><Header icon={<Crown className="h-6 w-6 text-amber-400"/>} title="ELITE PERFORMANCE" subtitle="Filtro analítico baseado no motor quantitativo atual" onRefresh={refetch}/>{isLoading?<Loading/>:rows.length===0?<Empty text="Nenhum jogo atingiu o filtro Elite com dados válidos."/>:<div className="grid gap-3">{rows.map(({m,goals,corners,cards,score})=><section key={String(m.id||(m as any).fixture?.id)} className={card+' p-4'}><div className="flex items-center justify-between"><div className="font-bold text-sm"><MatchName match={m}/></div><span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-black text-amber-400">ELITE SCORE {score}</span></div><div className="mt-4 grid grid-cols-3 gap-2">{[['Gols',goals],['Escanteios',corners],['Cartões',cards]].map(([label,value]:any)=><div key={label} className="rounded-lg bg-white/5 p-2"><div className="text-[10px] text-gray-500">{label}</div><div className="text-lg font-bold">{value}%</div><div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-amber-400" style={{width:`${Math.min(100,value)}%`}}/></div></div>)}</div></section>)}</div>}</main></div>;
}

export function CorrectScore() {
  const { data, isLoading, refetch } = useMatches();
  const rows = useMemo(() => data.filter(modelReady).map(m=>({m,scores:exactScoreDistribution(m)})).filter(x=>x.scores.length).slice(0,16),[data]);
  return <div className={shell}><main className="container max-w-6xl mx-auto px-4 py-6"><Header icon={<Target className="h-6 w-6 text-cyan-400"/>} title="PLACAR EXATO" subtitle="Poisson + ajuste Bayesiano + xG do NEXUS Core • leitura indicativa" onRefresh={refetch}/>{isLoading?<Loading/>:rows.length===0?<Empty text="Sem amostra suficiente para calcular placares exatos."/>:<div className="grid gap-3 md:grid-cols-2">{rows.map(({m,scores})=><section key={String(m.id||(m as any).fixture?.id)} className={card+' p-4'}><div className="mb-3 flex items-center justify-between"><div className="font-bold text-sm"><MatchName match={m}/></div><span className="text-[9px] text-gray-500">NEXUS CORE</span></div><div className="grid grid-cols-4 gap-2">{scores.map(s=><div key={s.score} className="rounded-lg border border-cyan-500/10 bg-cyan-500/5 p-2 text-center"><div className="font-black text-cyan-300">{s.score}</div><div className="text-[10px] text-gray-500">{Math.round(s.probability*100)}%</div></div>)}</div></section>)}</div>}</main></div>;
}

export function BetAnalyzer() {
  const { data, isLoading, refetch } = useMatches();
  const scenarios = useMemo(() => data.map(m=>{const markets=validatedMarkets(m).filter(x=>x.probability>=75).sort((a,b)=>b.probability-a.probability); return {m,best:markets[0],goals:markets.find(x=>x.category==='goals'),corners:markets.find(x=>x.category==='corners'),cards:markets.find(x=>x.category==='cards')};}).filter(x=>x.best).sort((a,b)=>b.best.probability-a.best.probability).slice(0,20),[data]);
  return <div className={shell}><main className="container max-w-6xl mx-auto px-4 py-6"><Header icon={<Crosshair className="h-6 w-6 text-orange-400"/>} title="BET ANALYZER" subtitle="Cenários analíticos integrados ao NEXUS Core" onRefresh={refetch}/>{isLoading?<Loading/>:scenarios.length===0?<Empty text="Nenhum cenário disponível com dados válidos."/>:<div className="grid gap-3">{scenarios.map(({m,best,goals,corners,cards})=><section key={String(m.id||(m as any).fixture?.id)} className={card+' p-4'}><div className="flex items-center justify-between mb-3"><div className="font-bold text-sm"><MatchName match={m}/></div><span className="text-xs font-black text-emerald-400">Principal {best.probability}%</span></div><div className="grid gap-2 sm:grid-cols-3">{[['Gols',goals],['Escanteios',corners],['Cartões',cards]].map(([label,value]:any)=><div key={label} className="rounded-xl bg-white/5 p-3"><div className="text-[10px] uppercase text-gray-500">{label}</div>{value?<><div className="mt-1 text-lg font-black">{value.market}</div><div className="text-sm text-emerald-400">{value.probability}%</div><div className="text-[10px] text-gray-500">{value.risk}</div></>:<div className="mt-2 text-xs text-gray-600">Sem dado</div>}</div>)}</div></section>)}</div>}</main></div>;
}
