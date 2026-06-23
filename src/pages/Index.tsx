import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMultiDayMatches, isOfflineMode, getOfflineSince, getOfflineReason } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { isPremiumLeague } from '@/lib/premiumLeagues';
import { localizeTeamName } from '@/lib/teamI18n';
// World Cup matches are now shown on the Home tab as well (user request)

import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { Loader2, RefreshCw, Trash2, WifiOff, Send, Crown } from 'lucide-react';
import bannerImg from "@/assets/banner-hero.jpg";
import bgPattern from "@/assets/bg-circuit-pattern.jpg";
import { APP_TIMEZONE, formatTimePara, getTodayInPara } from "@/lib/timezone";

/** YYYY-MM-DD em UTC-3 (Belém) para uma data arbitrária. */
function paraDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

const LEAGUE_LABELS: Record<string, string> = {
  'Premier League': '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier',
  'La Liga': '🇪🇸 La Liga',
  'Bundesliga': '🇩🇪 Bundes',
  'Ligue 1': '🇫🇷 Ligue 1',
  'Brasileirão Série A': '🇧🇷 Brasileirão',
  'Serie A (ITA)': '🇮🇹 Serie A',
  'Copa Libertadores': '🏆 Libertadores',
  'Champions League': '🏆 Champions',
};

const Index = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<number>(0);
  const [premiumFilter, setPremiumFilter] = useState<'all' | 'premium'>('all');
  const [offline, setOffline] = useState<boolean>(isOfflineMode());

  useEffect(() => {
    const handler = () => setOffline(isOfflineMode());
    window.addEventListener('football-offline-change', handler);
    return () => window.removeEventListener('football-offline-change', handler);
  }, []);

  // Fetch 6 days (today + 5)
  const { data: rawMatches, isFetching, refetch } = useQuery({
    queryKey: ['matches-multiday'],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 60 * 24, // 24h — pré-jogo carrega 1x por dia
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Generate day labels (BRT/Pará)
  const dayOptions = useMemo(() => {
    const days = [];
    const today = getTodayInPara(); // YYYY-MM-DD in BRT
    const base = new Date(`${today}T12:00:00-03:00`);
    for (let i = 0; i < 6; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const dateStr = paraDateString(d);
      const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : new Intl.DateTimeFormat('pt-BR', {
        timeZone: APP_TIMEZONE, weekday: 'short', day: '2-digit',
      }).format(d);
      days.push({ index: i, date: dateStr, label });
    }
    return days;
  }, []);

  const safeMatches = useMemo(() =>
    (rawMatches || [])
      .map((m: any) => {
      const hStats = m.homeStats || {};
      const aStats = m.awayStats || {};
      const hGF = hStats.goalsFor || 0;
      const hGA = hStats.goalsAgainst || 0;
      const aGF = aStats.goalsFor || 0;
      const aGA = aStats.goalsAgainst || 0;
      const hasHome = hGF > 0 || hGA > 0;
      const hasAway = aGF > 0 || aGA > 0;

      // Dynamic league avg from backend (Bayesian regression already applied server-side)
      const leagueAvg = hStats.leagueAvg || aStats.leagueAvg || 1.30;
      const homeN = hStats.gamesCount || (hasHome ? 5 : 0);
      const awayN = aStats.gamesCount || (hasAway ? 5 : 0);
      const k = 3;
      // Bayesian regression for frontend predictions
      const adjHGF = homeN > 0 ? (homeN * hGF + k * leagueAvg) / (homeN + k) : leagueAvg;
      const adjAGF = awayN > 0 ? (awayN * aGF + k * leagueAvg) / (awayN + k) : leagueAvg;
      const adjHGA = homeN > 0 ? (homeN * hGA + k * leagueAvg) / (homeN + k) : leagueAvg;
      const adjAGA = awayN > 0 ? (awayN * aGA + k * leagueAvg) / (awayN + k) : leagueAvg;

      const homeLambda = adjHGF > 0 && adjAGA > 0
        ? (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg
        : adjHGF;
      const awayLambda = adjAGF > 0 && adjHGA > 0
        ? (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg
        : adjAGF;
      const totalLambda = homeLambda + awayLambda;

      // Probabilidades via força relativa (não inventada)
      const homeStrength = homeLambda / (totalLambda || 1);
      const awayStrength = awayLambda / (totalLambda || 1);
      const homeWin = Math.round(homeStrength * 70 + (hasHome ? 5 : 0));
      const awayWin = Math.round(awayStrength * 70 + (hasAway ? 5 : 0));
      const draw = Math.max(5, 100 - homeWin - awayWin);

      return {
        ...m,
        homeTeam: localizeTeamName(m.teams?.home?.name || m.homeTeam) || 'Casa',
        awayTeam: localizeTeamName(m.teams?.away?.name || m.awayTeam) || 'Fora',
        homeLogo: m.teams?.home?.logo,
        awayLogo: m.teams?.away?.logo,
        league: m.league?.name || m.league || '',
        time: m.fixture?.date
          ? formatTimePara(m.fixture.date)
          : m.time || '',
        modelData: {
          homeGoalsAvg: hGF,
          awayGoalsAvg: aGF,
          homeGoalsAgainstAvg: hGA,
          awayGoalsAgainstAvg: aGA,
        },
        homeStats: hStats,
        awayStats: aStats,
        sampleSize: {
          homeGames: hStats.gamesCount || (hasHome ? 5 : 0),
          awayGames: aStats.gamesCount || (hasAway ? 5 : 0),
          homeWithStats: hStats.gamesCount || (hasHome ? 5 : 0),
          awayWithStats: aStats.gamesCount || (hasAway ? 5 : 0),
        },
        predictions: { homeWin: String(homeWin), draw: String(draw), awayWin: String(awayWin) },
        isPremium: isPremiumLeague(m.league?.name || m.league || ''),
      };
    }),
  [rawMatches]);

  // Filter by selected day
  const selectedDate = dayOptions[selectedDay]?.date || '';
  const dayMatches = useMemo(() => {
    if (!selectedDate) return safeMatches;
    return safeMatches.filter((m: any) => {
      const matchDate = m.fixture?.date ? paraDateString(new Date(m.fixture.date)) : m.date || '';
      return matchDate === selectedDate;
    });
  }, [safeMatches, selectedDate]);

  // Extract unique leagues for filter
  const availableLeagues = useMemo(() => {
    const leagues = new Set<string>();
    dayMatches.forEach((m: any) => {
      if (m.league) leagues.add(m.league);
    });
    return Array.from(leagues).sort();
  }, [dayMatches]);

  // Filter by league + premium + sort (premium first)
  const filteredMatches = useMemo(() => {
    let result = dayMatches;
    if (selectedLeague !== 'all') {
      result = result.filter((m: any) => m.league === selectedLeague);
    }
    if (premiumFilter === 'premium') {
      result = result.filter((m: any) => m.isPremium);
    }
    // Sort: premium first, then by time
    return result.sort((a: any, b: any) => {
      if (a.isPremium && !b.isPremium) return -1;
      if (!a.isPremium && b.isPremium) return 1;
      return (a.time || '').localeCompare(b.time || '');
    });
  }, [dayMatches, selectedLeague, premiumFilter]);

  return (
    <div className="min-h-screen text-white pb-8 font-sans relative">
      {/* Full-screen circuit background */}
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `url(${bgPattern})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div className="fixed inset-0 z-0 bg-black/40" />

      <main className="container max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Controls Bar */}
        <div className="flex items-center justify-between pt-4 pb-2">
          <h1 className="text-2xl font-bold">PRÉ-JOGO</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2.5 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Atualizar">
              <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
            </button>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2.5 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Limpar cache">
              <Trash2 className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

        </div>

        {/* Banner Modo Offline / API suspensa */}
        {offline && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
            <WifiOff className="w-4 h-4 shrink-0" />
            <div className="text-xs leading-tight">
              {getOfflineReason() === 'api_suspended' ? (
                <>
                  <strong className="font-bold">API-Football suspensa</strong> — a conta do provedor de dados está bloqueada
                  (verifique em <span className="underline">dashboard.api-football.com</span>). Exibindo último pré-jogo salvo.
                </>
              ) : (
                <>
                  <strong className="font-bold">Modo offline</strong> — exibindo último pré-jogo salvo
                  {getOfflineSince() && ` (desde ${new Date(getOfflineSince()!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`}.
                  API de futebol indisponível ou sem cota.
                </>
              )}
            </div>
          </div>
        )}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {dayOptions.map(day => {
            const count = safeMatches.filter((m: any) => {
              const md = m.fixture?.date ? paraDateString(new Date(m.fixture.date)) : m.date || '';
              return md === day.date;
            }).length;
            return (
              <button
                key={day.index}
                onClick={() => { setSelectedDay(day.index); setSelectedLeague('all'); }}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                  selectedDay === day.index
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                }`}
              >
                {day.label} {count > 0 && `(${count})`}
              </button>
            );
          })}

        </div>

        {/* Identity Banner */}
        <div className="mt-6 relative overflow-hidden rounded-2xl shadow-2xl shadow-primary/10 max-w-3xl mx-auto">
          <img
            src={bannerImg}
            alt="Nexus 33"
            className="w-full h-auto block rounded-2xl"
          />
        </div>

        {/* Telegram Group CTA */}
        <a
          href="https://t.me/sinais_joilson"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center gap-2 w-full max-w-3xl mx-auto bg-gradient-to-r from-[#229ED9] to-[#1d8bbf] hover:from-[#1d8bbf] hover:to-[#1879a8] text-white font-bold py-4 px-4 rounded-xl shadow-lg shadow-[#229ED9]/30 transition-all"
        >
          <Send className="w-5 h-5" fill="currentColor" />
          <span className="text-base tracking-wide">ENTRAR NO GRUPO DE SINAIS NO TELEGRAM</span>
        </a>


        {/* Premium Filter */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setPremiumFilter('all')}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${
              premiumFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white/5 text-muted-foreground hover:bg-white/10'
            }`}
          >
            <Crown className="w-3.5 h-3.5" />
            Todas ({dayMatches.length})
          </button>
          <button
            onClick={() => setPremiumFilter('premium')}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${
              premiumFilter === 'premium'
                ? 'bg-amber-500 text-amber-950'
                : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20'
            }`}
          >
            <Crown className="w-3.5 h-3.5" fill="currentColor" />
            🔥 Premium ({dayMatches.filter((m: any) => m.isPremium).length})
          </button>
        </div>

        {/* League Filter */}
        {availableLeagues.length > 1 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button
              onClick={() => setSelectedLeague('all')}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                selectedLeague === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              }`}
            >
              Ligas ({dayMatches.length})
            </button>
            {availableLeagues.map(league => {
              const count = dayMatches.filter((m: any) => m.league === league).length;
              const label = LEAGUE_LABELS[league] || league;
              const isLeaguePremium = isPremiumLeague(league);
              return (
                <button
                  key={league}
                  onClick={() => setSelectedLeague(league)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${
                    selectedLeague === league
                      ? 'bg-primary text-primary-foreground'
                      : isLeaguePremium
                        ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20'
                        : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                  }`}
                >
                  {isLeaguePremium && <Crown className="w-3 h-3 text-amber-400" fill="currentColor" />}
                  {label} ({count})
                </button>
              );
            })}

          </div>
        )}

        {/* Loading */}
        {isFetching && safeMatches.length === 0 && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Scanner PRO, Elite Performance e Bingo VIP migrados para páginas dedicadas:
            /scanner, /elite e /bingo — acessíveis pela barra lateral.
            A Home é dedicada exclusivamente às análises de Pré-Jogo. */}

        {/* Match Cards */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredMatches.map((match: any) => (
            <MatchCard key={match.id} match={match} isPremium={match.isPremium} />
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
