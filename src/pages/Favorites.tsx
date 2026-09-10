import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';
import type { MatchData } from '@/types/match';

export default function Favorites(){
  const [favorites,setFavorites]=useState<number[]>(()=>{try{return JSON.parse(localStorage.getItem('liveMatchFavorites')||'[]')}catch{return[]}});
  useEffect(()=>{localStorage.setItem('liveMatchFavorites',JSON.stringify(favorites))},[favorites]);
  const {data:allMatches=[],isLoading,refetch,isFetching}=useQuery({queryKey:['live-matches'],queryFn:fetchLiveMatches,refetchInterval:120000,staleTime:240000,refetchOnWindowFocus:false});
  const favMatches=useMemo(()=>{const ids=new Set(favorites.map(Number));return(allMatches as MatchData[]).filter(m=>ids.has(Number(m.id)))},[allMatches,favorites]);
  const clearAll=useCallback(()=>setFavorites([]),[]);
  return <main className="min-h-screen bg-background p-4 sm:p-6"><div className="mx-auto max-w-5xl"><header className="mb-5 flex items-center justify-between gap-3"><Link to="/live" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4"/> Live</Link><div className="flex items-center gap-2"><button onClick={()=>refetch()} className="rounded-lg border p-2" aria-label="Atualizar"><RefreshCw className={`h-4 w-4 ${isFetching?'animate-spin':''}`}/></button>{favorites.length>0&&<button onClick={clearAll} className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive"><Trash2 className="h-3.5 w-3.5"/> Limpar</button>}</div></header><div className="mb-5 flex items-center gap-2"><Star className="h-5 w-5"/><div><h1 className="text-xl font-bold">Favoritos</h1><p className="text-xs text-muted-foreground">{favorites.length} partida(s) monitorada(s)</p></div></div>{isLoading?<p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>:favMatches.length===0?<div className="rounded-2xl border border-border/50 bg-card p-8 text-center text-sm text-muted-foreground">Nenhum favorito ao vivo neste momento.</div>:<div className="grid gap-3 md:grid-cols-2">{favMatches.map(m=><article key={m.id} className="rounded-2xl border border-border/50 bg-card p-4"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.league}</div><div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><b className="text-right text-sm">{m.homeTeam}</b><span className="rounded-lg bg-secondary px-3 py-1 text-xs font-bold">{m.liveScore?`${m.liveScore.home}–${m.liveScore.away}`:'—'}</span><b className="text-sm">{m.awayTeam}</b></div><p className="mt-3 text-[10px] text-muted-foreground">{m.minute!=null?`${m.minute}' · `:''}Dados observados; sem decisão independente de mercado.</p></article>)}</div>}</div></main>;
}
