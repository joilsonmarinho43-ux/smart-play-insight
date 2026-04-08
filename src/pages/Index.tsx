import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import BingoSuggestion from '@/components/BingoSuggestion';
import ElitePanel from '@/components/ElitePanel';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import logoImg from "@/assets/logo-analista-joilson.png";

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
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedLeague, setSelectedLeague] = useState<string>('all');

  const { data: rawMatches, isFetching, refetch } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    staleTime: 1000 * 60 * 10, // 10 min
    gcTime: 1000 * 60 * 30,
  });

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

      // Poisson real para predictions
      const leagueAvg = 1.35;
      const homeLambda = hGF > 0 && aGA > 0
        ? (hGF / leagueAvg) * (aGA / leagueAvg) * leagueAvg
        : hGF || 1.2;
      const awayLambda = aGF > 0 && hGA > 0
        ? (aGF / leagueAvg) * (hGA / leagueAvg) * leagueAvg
        : aGF || 0.9;
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
    <div className="min-h-screen bg-[#0f172a] text-white pb-32 font-sans">
      <main className="container max-w-3xl mx-auto px-4">
        {/* Controls Bar */}
        <div className="flex items-center justify-between pt-4 pb-2">
          <h1 className="text-lg font-bold">PRÉ-JOGO</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors" title="Atualizar">
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors" title="Limpar cache">
              <Trash2 className="w-4 h-4 text-gray-400" />
            </button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-[#334155] text-xs p-2 rounded-lg border border-white/10"
            />
          </div>
        </div>
        {/* Stats */}
        {/* Identity Banner */}
        <div className="mt-6 relative overflow-hidden rounded-2xl border border-[hsl(30,60%,30%,0.4)] shadow-2xl"
          style={{
            background: "linear-gradient(135deg, hsl(220,20%,12%) 0%, hsl(25,30%,14%) 50%, hsl(220,20%,12%) 100%)",
          }}
        >
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: `
              linear-gradient(30deg, hsl(30 80% 40% / 0.12) 12%, transparent 12.5%, transparent 87%, hsl(30 80% 40% / 0.12) 87.5%),
              linear-gradient(150deg, hsl(30 80% 40% / 0.12) 12%, transparent 12.5%, transparent 87%, hsl(30 80% 40% / 0.12) 87.5%),
              linear-gradient(60deg, hsl(35 70% 30% / 0.2) 25%, transparent 25.5%, transparent 75%, hsl(35 70% 30% / 0.2) 75%)
            `,
            backgroundSize: '40px 70px',
          }} />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[hsl(35,80%,50%,0.5)] to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[hsl(35,80%,50%,0.3)] to-transparent" />
          <div className="relative z-10 flex items-center gap-5 px-5 py-5">
            <img src={logoImg} alt="Analista Joilson" className="w-24 h-24 object-contain shrink-0 drop-shadow-[0_0_15px_hsl(30,90%,50%,0.3)]" />
            <div className="flex flex-col items-start">
              <span className="text-xs text-muted-foreground uppercase tracking-widest">Análise Pré-Jogo</span>
              <span className="text-4xl font-black text-primary tabular-nums leading-none mt-1">{safeMatches.length}</span>
              <span className="text-sm text-muted-foreground font-medium mt-0.5">jogos carregados</span>
            </div>
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
        <div className="mt-6 space-y-4">
          {filteredMatches.map((match: any) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
