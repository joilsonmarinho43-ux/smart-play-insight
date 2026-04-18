import { useQuery } from '@tanstack/react-query';
import { Loader2, Trophy } from 'lucide-react';
import { fetchMultiDayMatches } from '@/services/footballApi';
import BingoSuggestion from '@/components/BingoSuggestion';

const Bingo = () => {
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['multi-day-matches-bingo'],
    queryFn: () => fetchMultiDayMatches(),
    staleTime: 1000 * 60 * 10,
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="container max-w-3xl mx-auto px-4 py-6">
        <header className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center border border-orange-500/30">
            <Trophy className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-orange-400">BINGO VIP PRO</h1>
            <p className="text-[11px] text-gray-500 uppercase tracking-wider">
              10 estratégias • Poisson + xG • Confiança ≥ 72%
            </p>
          </div>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-20 text-gray-500 text-sm">
            Nenhum jogo elegível encontrado.
          </div>
        ) : (
          <BingoSuggestion matches={matches} />
        )}
      </div>
    </div>
  );
};

export default Bingo;
