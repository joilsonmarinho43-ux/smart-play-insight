import { useMemo, useState } from 'react';
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
  const min = Math.min(Number(s?.homeGames || 0), Number(s?.awayGames || 0));
  if (!s || min < 1) return <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300"><ShieldAlert className="h-3 w-3"/> Dados insuficientes</span>;
  const label = min >= 5 ? 'Confiança alta' : min >= 3 ? 'Confiança média' : 'Amostra limitada';
  return <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-300"><Database className="h-3 w-3"/> {label} · {s.homeGames}/{s.awayGames}</span>;
}

function StatRow({ label, home, away, suffix = '' }: { label: string; home: unknown; away: unknown; suffix?: string }) {
  const h=n(home), a=n(away); if(h==null&&a==null)return null;
  return <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-white/5 py-2.5 last:border-0"><span className="text-right text-sm font-black tabular-nums">{h==null?'—':`${fmt(h)}${suffix}`}</span><span className="text-[11px] text-gray-500 text-center">{label}</span><span className="text-sm font-black tabular-nums">{a==null?'—':`${fmt(a)}${suffix}`}</span></div>;
}

function Stats({ match }: { match: MatchData }) {
  const hs:any=(match as any).homeStats||{}, as:any=(match as any).awayStats||{}, md:any=match.modelData||{};
  return <div><div className="flex items-center justify-between border-b border-white/10 pb-2 mb-1"><span className="max-w-[40%] truncate text-[10px] font-black uppercase text-emerald-400">{match.homeTeam}</span><span className="text-[9px] uppercase tracking-wider text-gray-600">{String((match as any).statsSource||'').startsWith('ai')?'Estimativa IA':'Dados disponíveis'}</span><span className="max-w-[40%] truncate text-right text-[10px] font-black uppercase text-orange-400">{match.awayTeam}</span></div><StatRow label="Gols médios" home={md.homeGoalsAvg} away={md.awayGoalsAvg}/><StatRow label="Gols sofridos" home={md.homeGoalsAgainstAvg} away={md.awayGoalsAgainstAvg}/><StatRow label="Posse" home={hs.possession} away={as.possession} suffix="%"/><StatRow label="Finalizações" home={hs.totalShots} away={as.totalShots}/><StatRow label="No alvo" home={hs.shotsOnGoal} away={as.shotsOnGoal}/><StatRow label="Grandes chances" home={hs.bigChances} away={as.bigChances}/><StatRow label="Escanteios" home={hs.corners} away={as.corners}/><StatRow label="Cartões" home={hs.yellowCards} away={as.yellowCards}/>{!Number(md.homeGoalsAvg||0)&&!Number(md.awayGoalsAvg||0)&&!Number(hs.totalShots||0)&&!Number(as.totalShots||0)&&<p className="py-5 text-center text-xs text-gray-500">Aguardando histórico estatístico das equipes.</p>}</div>;
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
  const {data:form}=useTeamForm(rawMatch); const withForm=useMemo(()=>mergeFormIntoMatch(rawMatch,form),[rawMatch,form]);
  const match=withForm;
  const {reading,loading,context,analyst,analystLoading,analystError,fallback}=useMatchReading(match,readingOpen);
  const tabs:[Tab,string,any][]=[['stats','Estatísticas',BarChart3],['poisson','Poisson',TrendingUp],['ticket','Bilhete',Target]];
  return <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#101521]/90 shadow-2xl shadow-black/20 backdrop-blur-xl">
    <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3"><div className="flex min-w-0 items-center gap-2"><Trophy className={`h-4 w-4 shrink-0 ${isPremium?'text-amber-400':'text-orange-400'}`}/><span className="truncate text-xs font-bold text-gray-400">{match.league}</span>{isPremium&&<span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[8px] font-black text-amber-400">PREMIUM</span>}</div><div className="flex shrink-0 items-center gap-1 text-xs text-gray-500"><Clock className="h-3.5 w-3.5"/>{match.time}</div></div>
    <div className="px-4 pt-3"><Badge match={match}/></div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-5"><div className="text-right"><h2 className="text-lg font-black leading-tight sm:text-xl">{match.homeTeam}</h2><span className="text-sm font-black text-emerald-400">{match.predictions?.homeWin ?? '—'}%</span></div><div className="text-center"><div className="text-xl font-black text-gray-500">VS</div><div className="text-[10px] text-gray-600">E {match.predictions?.draw ?? '—'}%</div></div><div><h2 className="text-lg font-black leading-tight sm:text-xl">{match.awayTeam}</h2><span className="text-sm font-black text-orange-400">{match.predictions?.awayWin ?? '—'}%</span></div></div>
    <div className="flex gap-2 px-4">{tabs.map(([key,label,Icon])=><button key={key} onClick={()=>setTab(key)} className={`flex flex-1 items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[10px] font-black uppercase tracking-wider transition ${tab===key?'bg-orange-500 text-black':'bg-white/5 text-gray-400 hover:bg-white/10'}`}><Icon className="h-3.5 w-3.5"/>{label}</button>)}</div>
    <div className="px-4 py-4">{tab==='stats'?<Stats match={match}/>:tab==='poisson'?<Poisson match={match}/>:<Ticket match={match}/>}</div>
    <div className="px-4 pb-3"><button onClick={()=>setReadingOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 py-2.5 text-xs font-black text-orange-300 hover:bg-orange-500/20"><BookOpen className="h-4 w-4"/>📖 Leitura do Jogo</button></div>
    <div className="border-t border-white/5 py-2 text-center text-[8px] uppercase tracking-widest text-gray-600">NEXUS CORE · dados observados + modelo quantitativo</div>
    <MatchReadingModal open={readingOpen} onOpenChange={setReadingOpen} reading={reading} loading={loading} homeTeam={match.homeTeam} awayTeam={match.awayTeam} context={context} analyst={analyst} analystLoading={analystLoading} analystError={analystError} fallback={fallback}/>
  </article>;
}
