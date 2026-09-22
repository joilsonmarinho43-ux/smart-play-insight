import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, BookOpen, Clock, Database, Target, TrendingUp, Trophy, ShieldAlert, RefreshCw } from 'lucide-react';
import type { MatchData } from '@/types/match';
import { useTeamForm, mergeFormIntoMatch } from '@/hooks/useTeamForm';
import { useMatchReading } from '@/hooks/useMatchReading';
import { MatchReadingModal } from './MatchReadingModal';
import { analyzeMarkets, exactScoreDistribution } from '@/lib/matchAnalysis';

interface Props { match: MatchData; isPremium?: boolean; }
type Tab = 'stats' | 'poisson' | 'ticket';

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const fmt = (v: unknown, digits = 1) => { const x = n(v); return x == null ? '—' : x.toFixed(digits); };

function Badge({ match }: { match: MatchData }) {
  const s = match.sampleSize;
  const homeGames = n(s?.homeGames); const awayGames = n(s?.awayGames); const min = homeGames !== null && awayGames !== null ? Math.min(homeGames, awayGames) : null;
  if (!s || min === null || min < 1) return <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300"><ShieldAlert className="h-3 w-3"/> Dados insuficientes</span>;
  const label = min >= 5 ? 'Confiança alta' : min >= 3 ? 'Confiança média' : 'Amostra limitada';
  return <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-300"><Database className="h-3 w-3"/> {label} · {s.homeGames}/{s.awayGames}</span>;
}

function StatRow({ label, home, away, suffix = '', pillHome = true }: { label: string; home: unknown; away: unknown; suffix?: string; pillHome?: boolean }) {
  const h=n(home), a=n(away);
  if(h==null&&a==null)return null;
  const value=(v:number|null)=>v==null?'—':`${fmt(v)}${suffix}`;
  return <div className="grid grid-cols-[minmax(72px,1fr)_minmax(92px,1.25fr)_minmax(72px,1fr)] items-center gap-2 py-2.5">
    <div className={`flex justify-end ${pillHome?'':''}`}>
      {h==null ? <span className="px-2 text-right text-sm font-black tabular-nums">—</span> : <span className="inline-flex min-w-[72px] justify-center rounded-full bg-[#11999b] px-3 py-2 text-sm font-black tabular-nums text-white shadow-sm">{value(h)}</span>}
    </div>
    <span className="text-center text-sm font-medium leading-tight text-gray-900 dark:text-gray-200">{label}</span>
    <span className="text-left text-sm font-black tabular-nums text-gray-900 dark:text-white">{value(a)}</span>
  </div>;
}

function Stats({ match }: { match: MatchData }) {
  const hs:any=(match as any).homeStats||{}, as:any=(match as any).awayStats||{}, metrics:any=(match as any).metrics||{};
  const home=(key:string, metricKey?:string)=>metrics?.[metricKey||key]?.[0] ?? hs?.[key] ?? null;
  const away=(key:string, metricKey?:string)=>metrics?.[metricKey||key]?.[1] ?? as?.[key] ?? null;
  const rows=[
    ['Gols', home('goals','goals'), away('goals','goals')],
    ['Posse de bola', home('possession','possession'), away('possession','possession'), '%'],
    ['Gols esperados (xG)', home('xG','xG'), away('xG','xG')],
    ['Finalizações Totais', home('totalShots','totalShots'), away('totalShots','totalShots')],
    ['Chutes no gol', home('shotsOnGoal','shotsOnTarget'), away('shotsOnGoal','shotsOnTarget')],
    ['Grandes chances criadas', home('bigChances','bigChances'), away('bigChances','bigChances')],
    ['Escanteios', home('corners','corners'), away('corners','corners')],
    ['Impedimentos', home('offsides','offsides'), away('offsides','offsides')],
    ['Faltas Cometidas', home('fouls','fouls'), away('fouls','fouls')],
    ['Cartões amarelos', home('yellowCards','yellowCards'), away('yellowCards','yellowCards')],
  ];
  const available=rows.filter(r=>n(r[1])!=null||n(r[2])!=null);
  return <div className="rounded-xl bg-white/95 px-2 py-1 dark:bg-transparent">
    <div className="mb-2 grid grid-cols-[minmax(72px,1fr)_minmax(92px,1.25fr)_minmax(72px,1fr)] items-center gap-2 border-b border-gray-200/10 pb-2">
      <span className="truncate text-right text-[10px] font-black uppercase text-emerald-400">{match.homeTeam}</span>
      <span className="text-center text-[9px] font-bold uppercase tracking-wider text-gray-500">ESTATÍSTICAS</span>
      <span className="truncate text-left text-[10px] font-black uppercase text-orange-400">{match.awayTeam}</span>
    </div>
    {available.map(([label,h,a,suffix],i)=><StatRow key={String(label)} label={String(label)} home={h} away={a} suffix={String(suffix||'')} />)}
    {!available.length && <p className="py-5 text-center text-xs text-gray-500">Aguardando histórico estatístico das equipes.</p>}
  </div>;
}
function Poisson({ match }: { match: MatchData }) {
  const scores=exactScoreDistribution(match); const top=scores.slice(0,6); const total=top.reduce((a,x)=>a+x.probability,0); const markets=analyzeMarkets(match).filter(x=>x.probability>0).sort((a,b)=>b.probability-a.probability).slice(0,4);
  if(!scores.length) return <div className="py-8 text-center text-sm text-gray-500">Sem amostra suficiente para o modelo Poisson.</div>;
  return <div className="space-y-4"><div className="grid grid-cols-3 gap-2">{top.map((s,i)=><div key={s.score} className={`rounded-xl border p-3 text-center ${i===0?'border-orange-500/40 bg-orange-500/10':'border-white/10 bg-white/5'}`}><div className="text-lg font-black text-orange-300">{s.score}</div><div className="text-[10px] text-gray-500">{Math.round(s.probability*100)}%</div></div>)}</div><div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-[9px] uppercase text-gray-500">Concentração Top 6</div><div className="mt-1 font-black">{Math.round(total*100)}%</div></div><div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-[9px] uppercase text-gray-500">Mercados do Core</div><div className="mt-1 font-black">{markets.length}</div></div></div></div>;
}

function Ticket({ match }: { match: MatchData }) {
  const markets=analyzeMarkets(match).filter(x=>x.probability>0).sort((a,b)=>b.probability-a.probability).slice(0,6);
  if(!markets.length) return <div className="py-8 text-center text-sm text-gray-500">Nenhum mercado calculável com os dados disponíveis.</div>;
  return <div className="space-y-2">{markets.map(m=><div key={m.market} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3"><div><div className="text-sm font-bold">{m.market}</div><div className="text-[10px] text-gray-500">{m.risk} · {m.probabilitySource}</div></div><div className="text-lg font-black text-emerald-400">{m.probability}%</div></div>)}</div>;
}

export default function MatchCard({ match: rawMatch, isPremium }: Props) {
  const [tab,setTab]=useState<Tab>('stats'); const [readingOpen,setReadingOpen]=useState(false);
  const [visible,setVisible]=useState(false);
  const cardRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const el=cardRef.current;
    if(!el||typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'500px 0px'});
    observer.observe(el);
    return()=>observer.disconnect();
  },[]);
  const {data:form}=useTeamForm(rawMatch,visible); const withForm=useMemo(()=>mergeFormIntoMatch(rawMatch,form),[rawMatch,form]);
  const match=withForm;
  const {reading,loading,context,analyst,analystLoading,analystError,fallback}=useMatchReading(match,readingOpen);
  const tabs:[Tab,string,any][]=[['stats','Estatísticas',BarChart3],['poisson','Poisson',TrendingUp],['ticket','Bilhete',Target]];
  return <article ref={cardRef} className="overflow-hidden rounded-2xl border border-white/10 bg-[#101521]/90 shadow-2xl shadow-black/20 backdrop-blur-xl">
    <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3"><div className="flex min-w-0 items-center gap-2"><Trophy className={`h-4 w-4 shrink-0 ${isPremium?'text-amber-400':'text-orange-400'}`}/><span className="truncate text-xs font-bold text-gray-400">{match.league}</span>{isPremium&&<span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[8px] font-black text-amber-400">PREMIUM</span>}</div><div className="flex shrink-0 items-center gap-1 text-xs text-gray-500"><Clock className="h-3.5 w-3.5"/>{match.time}</div></div>
    <div className="px-4 pt-3"><Badge match={match}/></div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-5"><div className="text-right"><h2 className="text-lg font-black leading-tight sm:text-xl">{match.homeTeam}</h2><span className="text-sm font-black text-emerald-400">{match.predictions?.probabilitySource === 'MODEL_ESTIMATE' && (match.predictions?.calibrationStatus === 'MODEL_VALIDATED' || match.predictions?.calibrationStatus === 'CALIBRATED') && Number.isFinite(match.predictions?.homeWin) ? match.predictions.homeWin : '—'}%</span></div><div className="text-center"><div className="text-xl font-black text-gray-500">VS</div><div className="text-[10px] text-gray-600">E {match.predictions?.probabilitySource === 'MODEL_ESTIMATE' && (match.predictions?.calibrationStatus === 'MODEL_VALIDATED' || match.predictions?.calibrationStatus === 'CALIBRATED') && Number.isFinite(match.predictions?.draw) ? match.predictions.draw : '—'}%</div></div><div><h2 className="text-lg font-black leading-tight sm:text-xl">{match.awayTeam}</h2><span className="text-sm font-black text-orange-400">{match.predictions?.probabilitySource === 'MODEL_ESTIMATE' && (match.predictions?.calibrationStatus === 'MODEL_VALIDATED' || match.predictions?.calibrationStatus === 'CALIBRATED') && Number.isFinite(match.predictions?.awayWin) ? match.predictions.awayWin : '—'}%</span></div></div>
    <div className="flex gap-2 px-4">{tabs.map(([key,label,Icon])=><button key={key} onClick={()=>setTab(key)} className={`flex flex-1 items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[10px] font-black uppercase tracking-wider transition ${tab===key?'bg-orange-500 text-black':'bg-white/5 text-gray-400 hover:bg-white/10'}`}><Icon className="h-3.5 w-3.5"/>{label}</button>)}</div>
    <div className="px-4 py-4">{tab==='stats'?<Stats match={match}/>:tab==='poisson'?<Poisson match={match}/>:<Ticket match={match}/>}</div>
    <div className="grid grid-cols-2 gap-2 px-4 pb-3"><Link to={`/match/${match.id}`} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-black text-gray-300 hover:bg-white/10"><BarChart3 className="h-4 w-4"/>Detalhes completos</Link><button onClick={()=>setReadingOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 py-2.5 text-xs font-black text-orange-300 hover:bg-orange-500/20"><BookOpen className="h-4 w-4"/>📖 Leitura do Jogo</button></div>
    <div className="border-t border-white/5 py-2 text-center text-[8px] uppercase tracking-widest text-gray-600">NEXUS CORE · dados observados + modelo quantitativo</div>
    <MatchReadingModal open={readingOpen} onOpenChange={setReadingOpen} reading={reading} loading={loading} homeTeam={match.homeTeam} awayTeam={match.awayTeam} context={context} analyst={analyst} analystLoading={analystLoading} analystError={analystError} fallback={fallback}/>
  </article>;
}
