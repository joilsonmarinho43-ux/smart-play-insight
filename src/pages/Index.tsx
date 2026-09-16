import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, Trash2, WifiOff, Send, Crown } from 'lucide-react';
import MatchCard from '@/components/MatchCard';
import { fetchMultiDayMatches, isOfflineMode, getOfflineSince } from '@/services/footballApi';
import { isPremiumLeague } from '@/lib/premiumLeagues';
import { APP_TIMEZONE, getTodayInPara } from '@/lib/timezone';
import type { MatchData } from '@/types/match';
import bannerImg from '@/assets/banner-hero.jpg';
import bgPattern from '@/assets/bg-circuit-pattern.jpg';

function paraDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const LEAGUE_LABELS: Record<string, string> = {
  'Premier League': '🏴 Premier',
  'La Liga': '🇪🇸 La Liga',
  'Bundesliga': '🇩🇪 Bundes',
  'Ligue 1': '🇫🇷 Ligue 1',
  'Brasileirão Série A': '🇧🇷 Brasileirão',
  'Serie A (ITA)': '🇮🇹 Serie A',
  'Copa Libertadores': '🏆 Libertadores',
  'Champions League': '🏆 Champions',
};

function getMatchDate(match: MatchData): string {
  const iso = match.kickoff || ((match as any).fixture?.date) || (typeof match.time === 'string' && match.time.includes('T') ? match.time : null);
  if (iso) return paraDateString(new Date(iso));
  return match.date || '';
}

function isUpcoming(match: MatchData): boolean {
  if (match.isLive) return false;
  const status = String((match as any).fixture?.status?.short ?? match.status ?? '').toUpperCase();
  if (['1H','2H','HT','ET','BT','LIVE','FT','AET','PEN','AWD','WO','SUSP','INT','IN_PLAY','PAUSED','FINISHED','AWARDED'].includes(status)) return false;
  const iso = match.kickoff || ((match as any).fixture?.date) || (typeof match.time === 'string' && match.time.includes('T') ? match.time : null);
  if (!iso) return true;
  const timestamp = new Date(iso).getTime();
  return Number.isNaN(timestamp) || timestamp >= Date.now() - 10 * 60 * 1000;
}

export default function Index() {
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [selectedDay, setSelectedDay] = useState(0);
  const [premiumFilter, setPremiumFilter] = useState<'all' | 'premium'>('all');
  const [offline, setOffline] = useState(isOfflineMode());

  useEffect(() => {
    const handler = () => setOffline(isOfflineMode());
    window.addEventListener('football-offline-change', handler);
    return () => window.removeEventListener('football-offline-change', handler);
  }, []);

  const todayKey = getTodayInPara();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['nexus-upcoming-matches', todayKey],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });

  const matches = useMemo(() => ((data || []) as MatchData[]).filter(isUpcoming), [data]);
  const days = useMemo(() => {
    const base = new Date(`${todayKey}T12:00:00-03:00`);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const date = paraDateString(d);
      const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TIMEZONE, weekday: 'short', day: '2-digit' }).format(d);
      return { index: i, date, label };
    });
  }, [todayKey]);

  const dayMatches = useMemo(() => {
    const selected = days[selectedDay]?.date;
    return selected ? matches.filter(m => getMatchDate(m) === selected) : matches;
  }, [matches, days, selectedDay]);

  const leagues = useMemo(() => Array.from(new Set(dayMatches.map(m => m.league).filter(Boolean))).sort(), [dayMatches]);
  const filteredMatches = useMemo(() => {
    let result = dayMatches;
    if (selectedLeague !== 'all') result = result.filter(m => m.league === selectedLeague);
    if (premiumFilter === 'premium') result = result.filter(m => isPremiumLeague(m.league || ''));
    return [...result].sort((a, b) => {
      const ap = isPremiumLeague(a.league || ''), bp = isPremiumLeague(b.league || '');
      if (ap !== bp) return ap ? -1 : 1;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });
  }, [dayMatches, selectedLeague, premiumFilter]);

  return (
    <div className="min-h-screen text-white pb-8 font-sans relative">
      <div className="fixed inset-0 z-0" style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
      <div className="fixed inset-0 z-0 bg-black/40" />
      <main className="container max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="flex items-center justify-between pt-4 pb-2">
          <h1 className="text-2xl font-bold">PRÉ-JOGO</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} disabled={isFetching} className="p-2.5 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Atualizar"><RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin text-primary' : 'text-muted-foreground'}`} /></button>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2.5 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Limpar cache"><Trash2 className="w-5 h-5 text-muted-foreground" /></button>
          </div>
        </div>
        {offline && <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200"><WifiOff className="w-4 h-4 shrink-0" /><div className="text-xs leading-tight"><strong className="font-bold">Modo offline</strong> — exibindo último pré-jogo salvo{getOfflineSince() && ` (desde ${new Date(getOfflineSince()!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`}.</div></div>}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {days.map(day => <button key={day.index} onClick={() => { setSelectedDay(day.index); setSelectedLeague('all'); }} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all ${selectedDay === day.index ? 'bg-primary text-primary-foreground' : 'bg-white/5 text-muted-foreground hover:bg-white/10'}`}>{day.label} {matches.filter(m => getMatchDate(m) === day.date).length > 0 && `(${matches.filter(m => getMatchDate(m) === day.date).length})`}</button>)}
        </div>
        <div className="mt-6 relative overflow-hidden rounded-2xl shadow-2xl shadow-primary/10 max-w-3xl mx-auto"><img src={bannerImg} alt="Nexus 33" className="w-full h-auto block rounded-2xl" /></div>
        <a href="https://t.me/sinais_joilson" target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center justify-center gap-2 w-full max-w-3xl mx-auto bg-gradient-to-r from-[#229ED9] to-[#1d8bbf] hover:from-[#1d8bbf] hover:to-[#1879a8] text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all"><Send className="w-5 h-5" fill="currentColor" /><span className="text-base tracking-wide">ENTRAR NO GRUPO DE SINAIS NO TELEGRAM</span></a>
        <div className="mt-4 flex gap-2"><button onClick={() => setPremiumFilter('all')} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${premiumFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-white/5 text-muted-foreground hover:bg-white/10'}`}><Crown className="w-3.5 h-3.5" />Todas ({dayMatches.length})</button><button onClick={() => setPremiumFilter('premium')} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${premiumFilter === 'premium' ? 'bg-amber-500 text-amber-950' : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20'}`}><Crown className="w-3.5 h-3.5" fill="currentColor" />🔥 Premium ({dayMatches.filter(m => isPremiumLeague(m.league || '')).length})</button></div>
        {leagues.length > 1 && <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide"><button onClick={() => setSelectedLeague('all')} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold ${selectedLeague === 'all' ? 'bg-primary text-primary-foreground' : 'bg-white/5 text-muted-foreground'}`}>Ligas ({dayMatches.length})</button>{leagues.map(league => <button key={league} onClick={() => setSelectedLeague(league)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold ${selectedLeague === league ? 'bg-primary text-primary-foreground' : isPremiumLeague(league) ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-white/5 text-muted-foreground'}`}>{LEAGUE_LABELS[league] || league} ({dayMatches.filter(m => m.league === league).length})</button>)}</div>}
        {error && <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Não foi possível carregar os dados reais. Toque em Atualizar para tentar novamente.</div>}
        {isLoading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}
        {!isLoading && filteredMatches.length === 0 && <div className="mt-8 rounded-xl border border-border bg-black/40 p-6 text-center"><div className="font-display text-lg text-foreground">Nenhum jogo para {days[selectedDay]?.label?.toLowerCase() || 'esta data'}</div><p className="mt-1 text-sm text-muted-foreground">Atualize a lista ou escolha outro dia.</p></div>}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">{filteredMatches.map(match => <MatchCard key={match.id || (match as any).fixture?.id} match={match} isPremium={isPremiumLeague(match.league || '')} />)}</div>
      </main>
    </div>
  );
}
