import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import BingoSuggestion from '@/components/BingoSuggestion';
import MatchSummaryBanner from '@/components/MatchSummaryBanner';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { 
  Calendar, Brain, BarChart3, Loader2, AlertCircle, 
  LogOut, Shield, Filter, AlertTriangle, ChevronUp, 
  ChevronDown, Zap 
} from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set());
  const [showFilter, setShowFilter] = useState(false);
  const [summaryFilterIds, setSummaryFilterIds] = useState<string[] | null>(null);
  const [summaryFilterLabel, setSummaryFilterLabel] = useState<string | null>(null);
  const [showLowConfidence, setShowLowConfidence] = useState(false);

  // Removido o "enabled: false" para que ele busque os jogos assim que abrir
  const { data: matches, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const filteredMatches = useMemo(() => {
    if (!matches) return [];
    let result = [...matches];
    if (selectedLeagues.size > 0) {
      result = result.filter((m) => selectedLeagues.has(m.league));
    }
    return result;
  }, [matches, selectedLeagues]);

  const displayMatches = useMemo(() => {
    if (!summaryFilterIds) return filteredMatches;
    const idSet = new Set(summaryFilterIds);
    return filteredMatches.filter((m) => idSet.has(String(m.id)));
  }, [filteredMatches, summaryFilterIds]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-primary" />
            <div>
              <h1 className="font-display text-2xl text-foreground tracking-tighter">ANALISTA JOILSON</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Modelo Pro</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              value={date} 
              onChange={(e) => setDate(e.target.value)}
              className="bg-secondary text-xs p-2 rounded-lg outline-none"
            />
            <button onClick={() => refetch()} className="bg-primary p-2 rounded-lg text-white">
              <BarChart3 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6">
        {isFetching && <div className="text-center py-10"><Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" /></div>}
        
        {displayMatches.length > 0 ? (
          <div className="space-y-4">
            {displayMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : !isFetching && (
          <div className="text-center py-20 text-muted-foreground">
            Nenhum jogo encontrado para as ligas selecionadas nesta data.
          </div>
        )}
      </main>

      {/* BOTÃO LIVE - FORÇADO NO CANTO */}
      <div className="fixed bottom-8 right-6 z-[100]">
        <Link 
          to="/live" 
          className="flex items-center gap-3 bg-orange-500 hover:bg-orange-600 text-white px-6 py-4 rounded-full shadow-[0_0_20px_rgba(249,115,22,0.4)] transition-all scale-110 active:scale-95 border-2 border-white/20"
        >
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
          </div>
          <span className="font-black tracking-tighter">LIVE TRADE</span>
          <Zap className="w-5 h-5 fill-current" />
        </Link>
      </div>
    </div>
  );
};

export default Index;
