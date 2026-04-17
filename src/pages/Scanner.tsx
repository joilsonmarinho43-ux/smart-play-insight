import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crosshair } from 'lucide-react';
import { fetchMultiDayMatches } from '@/services/footballApi';
import ScannerProPanel from '@/components/ScannerProPanel';
import bgPattern from '@/assets/bg-circuit-pattern.jpg';

const Scanner = () => {
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['matches-multiday'],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const safeMatches = (matches || []).map((m: any) => ({
    ...m,
    homeTeam: m.teams?.home?.name || m.homeTeam || 'Casa',
    awayTeam: m.teams?.away?.name || m.awayTeam || 'Fora',
    league: m.league?.name || m.league || '',
    time: m.fixture?.date
      ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(m.fixture.date))
      : m.time || '',
  }));

  return (
    <div className="min-h-screen text-white pb-8 font-sans relative">
      <div
        className="fixed inset-0 z-0"
        style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="fixed inset-0 z-0 bg-black/50" />

      <main className="container max-w-3xl mx-auto px-4 relative z-10 pt-4">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-2 bg-black/30 rounded-lg hover:bg-black/50">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Crosshair className="w-6 h-6 text-orange-500" />
          <h1 className="text-xl font-black uppercase tracking-wider">Scanner PRO</h1>
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">Carregando jogos...</p>
        ) : (
          <ScannerProPanel matches={safeMatches} />
        )}
      </main>
    </div>
  );
};

export default Scanner;
