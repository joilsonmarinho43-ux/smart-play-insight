import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches, fetchMultiDayMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import BingoSuggestion from '@/components/BingoSuggestion';
import ElitePanel from '@/components/ElitePanel';
import ScannerProPanel from '@/components/ScannerProPanel';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import bannerImg from "@/assets/banner-hero.jpg";
import bgPattern from "@/assets/bg-circuit-pattern.jpg";

const LEAGUE_LABELS: Record<string, string> = {
  'Premier League': '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier',
  'La Liga': '🇪🇸 La Liga',
  'Bundesliga': '🇩🇪 Bundes',
  'Ligue 1': '🇫🇷 Ligue 1',
  'Brasileirão Série A': '🇧🇷 Brasileirão',
  'Serie A (ITA)': '🇮🇹 Serie A',
};

const Index = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<number>(0);

  // Fetch 6 days (today + 5)
  const { data: rawMatches, isFetching, refetch } = useQuery({
    queryKey: ['matches-multiday'],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  // Generate day labels
  const dayOptions = useMemo(() => {
    const days = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
      days.push({ index: i, date: dateStr, label });
    }
    return days;
  }, []);

  const safeMatches = useMemo(() =>
    (rawMatches || []).map((m: any) => {
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
        homeTeam: m.teams?.home?.name || m.homeTeam || 'Casa',
        awayTeam: m.teams?.away?.name || m.awayTeam || 'Fora',
        homeLogo: m.teams?.home?.logo,
        awayLogo: m.teams?.away?.logo,
        league: m.league?.name || m.league || '',
        time: m.fixture?.date
          ? new Date(m.fixture.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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
      };
    }),
  [rawMatches]);

  // Extract unique leagues for filter
  const availableLeagues = useMemo(() => {
    const leagues = new Set<string>();
    safeMatches.forEach((m: any) => {
      if (m.league) leagues.add(m.league);
    });
    return Array.from(leagues).sort();
  }, [safeMatches]);

  // Filtered matches
  const filteredMatches = useMemo(() => {
    if (selectedLeague === 'all') return safeMatches;
    return safeMatches.filter((m: any) => m.league === selectedLeague);
  }, [safeMatches, selectedLeague]);

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

      <main className="container max-w-3xl mx-auto px-4 relative z-10">
        {/* Controls Bar */}
        <div className="flex items-center justify-between pt-4 pb-2">
          <h1 className="text-lg font-bold">PRÉ-JOGO</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Atualizar">
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Limpar cache">
              <Trash2 className="w-4 h-4 text-gray-400" />
            </button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-black/40 backdrop-blur-sm text-xs p-2 rounded-lg border border-orange-500/20"
            />
          </div>
        </div>
        {/* Identity Banner — seamlessly integrated */}
        <div className="mt-6 relative overflow-hidden rounded-2xl shadow-2xl shadow-orange-500/10">
          <img
            src={bannerImg}
            alt="Analista Joilson"
            className="w-full h-auto block rounded-2xl"
          />
          <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-1.5 border border-orange-500/30">
            <span className="text-2xl font-black text-primary tabular-nums leading-none">{safeMatches.length}</span>
            <span className="text-[10px] text-muted-foreground ml-1.5">jogos</span>
          </div>
        </div>

        {/* League Filter */}
        {availableLeagues.length > 1 && (
          <div className="mt-6 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button
              onClick={() => setSelectedLeague('all')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                selectedLeague === 'all'
                  ? 'bg-orange-500 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              Todas ({safeMatches.length})
            </button>
            {availableLeagues.map(league => {
              const count = safeMatches.filter((m: any) => m.league === league).length;
              const label = LEAGUE_LABELS[league] || league;
              return (
                <button
                  key={league}
                  onClick={() => setSelectedLeague(league)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                    selectedLeague === league
                      ? 'bg-orange-500 text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Loading */}
        {isFetching && safeMatches.length === 0 && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          </div>
        )}

        {/* Scanner PRO */}
        {safeMatches.length > 0 && (
          <div className="mt-6">
            <ScannerProPanel matches={safeMatches} cacheKey={date} />
          </div>
        )}

        {/* Elite Performance VIP */}
        {safeMatches.length > 0 && (
          <div className="mt-6">
            <ElitePanel matches={safeMatches} />
          </div>
        )}

        {/* Bingo Section */}
        {safeMatches.length > 0 && (
          <div className="mt-6">
            <BingoSuggestion matches={safeMatches} />
          </div>
        )}

        {/* Match Cards */}
        <div className="mt-8 space-y-6">
          {filteredMatches.map((match: any) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
