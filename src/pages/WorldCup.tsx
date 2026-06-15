import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMultiDayMatches, isOfflineMode } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { Loader2, RefreshCw, Trash2, WifiOff, Trophy, Info } from 'lucide-react';
import bgPattern from "@/assets/bg-circuit-pattern.jpg";
import { APP_TIMEZONE, formatTimePara, getTodayInPara } from "@/lib/timezone";
import { localizeTeamName } from "@/lib/teamI18n";

/** Identifica jogos da Copa do Mundo / Eliminatórias / Amistosos de seleções. */
const WC_LEAGUE_PATTERNS = [
  'world cup',
  'copa do mundo',
  'friendlies',
  'amistoso',
  'international',
  'eliminat',
  'qualification',
];

function isWorldCupLeague(league: any): boolean {
  const name = (league?.name || league || '').toString().toLowerCase();
  if (!name) return false;
  // Exclui ligas de clubes que possam ter "international" no nome de forma incidental
  return WC_LEAGUE_PATTERNS.some(p => name.includes(p));
}

function paraDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

const DAYS_AHEAD = 30;

const WorldCup = () => {
  const [selectedDay, setSelectedDay] = useState<number | 'all'>('all');
  const [offline, setOffline] = useState<boolean>(isOfflineMode());

  useEffect(() => {
    const handler = () => setOffline(isOfflineMode());
    window.addEventListener('football-offline-change', handler);
    return () => window.removeEventListener('football-offline-change', handler);
  }, []);

  // Janela de 30 dias — cache separado por dias para não conflitar com a Home
  const { data: rawMatches, isFetching, refetch } = useQuery({
    queryKey: ['matches-multiday', DAYS_AHEAD],
    queryFn: () => fetchMultiDayMatches(DAYS_AHEAD),
    staleTime: 1000 * 60 * 60 * 24, // 24h
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const wcMatches = useMemo(() => {
    return (rawMatches || [])
      .filter((m: any) => isWorldCupLeague(m.league))
      .map((m: any) => {
        const hStats = m.homeStats || {};
        const aStats = m.awayStats || {};
        const hGF = hStats.goalsFor || 0;
        const hGA = hStats.goalsAgainst || 0;
        const aGF = aStats.goalsFor || 0;
        const aGA = aStats.goalsAgainst || 0;
        const hasHome = hGF > 0 || hGA > 0;
        const hasAway = aGF > 0 || aGA > 0;

        const leagueAvg = hStats.leagueAvg || aStats.leagueAvg || 1.30;
        const homeN = hStats.gamesCount || (hasHome ? 5 : 0);
        const awayN = aStats.gamesCount || (hasAway ? 5 : 0);
        const k = 3;
        const adjHGF = homeN > 0 ? (homeN * hGF + k * leagueAvg) / (homeN + k) : leagueAvg;
        const adjAGF = awayN > 0 ? (awayN * aGF + k * leagueAvg) / (awayN + k) : leagueAvg;
        const adjHGA = homeN > 0 ? (homeN * hGA + k * leagueAvg) / (homeN + k) : leagueAvg;
        const adjAGA = awayN > 0 ? (awayN * aGA + k * leagueAvg) / (awayN + k) : leagueAvg;

        const homeLambda = (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg;
        const awayLambda = (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg;
        const totalLambda = homeLambda + awayLambda;

        const homeStrength = homeLambda / (totalLambda || 1);
        const awayStrength = awayLambda / (totalLambda || 1);
        const homeWin = Math.round(homeStrength * 70 + (hasHome ? 5 : 0));
        const awayWin = Math.round(awayStrength * 70 + (hasAway ? 5 : 0));
        const draw = Math.max(5, 100 - homeWin - awayWin);

        const semDados = !hasHome && !hasAway;

        return {
          ...m,
          homeTeam: m.teams?.home?.name || m.homeTeam || 'Casa',
          awayTeam: m.teams?.away?.name || m.awayTeam || 'Fora',
          homeLogo: m.teams?.home?.logo,
          awayLogo: m.teams?.away?.logo,
          league: m.league?.name || m.league || '',
          time: m.fixture?.date ? formatTimePara(m.fixture.date) : m.time || '',
          modelData: {
            homeGoalsAvg: hGF,
            awayGoalsAvg: aGF,
            homeGoalsAgainstAvg: hGA,
            awayGoalsAgainstAvg: aGA,
          },
          homeStats: hStats,
          awayStats: aStats,
          sampleSize: {
            homeGames: homeN,
            awayGames: awayN,
            homeWithStats: homeN,
            awayWithStats: awayN,
          },
          predictions: { homeWin: String(homeWin), draw: String(draw), awayWin: String(awayWin) },
          isPremium: true,
          isWorldCupPrediction: semDados,
        };
      });
  }, [rawMatches]);

  // Dias com jogos (até 30)
  const dayOptions = useMemo(() => {
    const today = getTodayInPara();
    const base = new Date(`${today}T12:00:00-03:00`);
    const days: { index: number; date: string; label: string; count: number }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const dateStr = paraDateString(d);
      const count = wcMatches.filter((m: any) => {
        const md = m.fixture?.date ? paraDateString(new Date(m.fixture.date)) : m.date || '';
        return md === dateStr;
      }).length;
      if (count === 0) continue;
      const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : new Intl.DateTimeFormat('pt-BR', {
        timeZone: APP_TIMEZONE, weekday: 'short', day: '2-digit', month: '2-digit',
      }).format(d);
      days.push({ index: i, date: dateStr, label, count });
    }
    return days;
  }, [wcMatches]);

  const filteredMatches = useMemo(() => {
    let result = wcMatches;
    if (selectedDay !== 'all') {
      const selected = dayOptions.find(d => d.index === selectedDay);
      if (selected) {
        result = result.filter((m: any) => {
          const md = m.fixture?.date ? paraDateString(new Date(m.fixture.date)) : m.date || '';
          return md === selected.date;
        });
      }
    }
    return [...result].sort((a: any, b: any) => {
      const ta = a.fixture?.date || '';
      const tb = b.fixture?.date || '';
      return ta.localeCompare(tb);
    });
  }, [wcMatches, selectedDay, dayOptions]);

  return (
    <div className="min-h-screen text-white pb-8 font-sans relative">
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
        <div className="flex items-center justify-between pt-4 pb-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-400" />
            COPA DO MUNDO
          </h1>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2.5 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Atualizar">
              <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
            </button>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2.5 bg-black/30 backdrop-blur-sm rounded-lg hover:bg-black/50 transition-colors" title="Limpar cache">
              <Trash2 className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Banner Previsão */}
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-amber-200">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="text-xs leading-snug">
            <strong className="font-bold">Modo Previsão:</strong> análise baseada no histórico recente das seleções
            (últimos jogos, médias de gols, escanteios e cartões) quando a competição ainda não possui estatísticas próprias.
          </div>
        </div>

        {offline && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
            <WifiOff className="w-4 h-4 shrink-0" />
            <div className="text-xs">Modo offline — exibindo último dado salvo.</div>
          </div>
        )}

        {/* Filtros por dia */}
        {dayOptions.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button
              onClick={() => setSelectedDay('all')}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                selectedDay === 'all' ? 'bg-primary text-primary-foreground' : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              }`}
            >
              Todos ({wcMatches.length})
            </button>
            {dayOptions.map(day => (
              <button
                key={day.index}
                onClick={() => setSelectedDay(day.index)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                  selectedDay === day.index ? 'bg-primary text-primary-foreground' : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                }`}
              >
                {day.label} ({day.count})
              </button>
            ))}
          </div>
        )}

        {isFetching && wcMatches.length === 0 && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {!isFetching && wcMatches.length === 0 && (
          <div className="mt-12 text-center text-muted-foreground">
            <Trophy className="w-12 h-12 mx-auto text-amber-400/50 mb-3" />
            <p className="text-sm">Nenhum jogo da Copa do Mundo encontrado nos próximos {DAYS_AHEAD} dias.</p>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredMatches.map((match: any) => (
            <div key={match.id} className="relative">
              {match.isWorldCupPrediction && (
                <div className="absolute -top-2 left-3 z-10 bg-amber-500 text-amber-950 text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg">
                  PREVISÃO
                </div>
              )}
              <MatchCard match={match} isPremium />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default WorldCup;
