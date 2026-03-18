import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

type Match = {
  id: number;
  home: string;
  away: string;
  minute: string;
};

const Live = () => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  // Simulação (depois você pode ligar API real)
  useEffect(() => {
    setTimeout(() => {
      setMatches([
        { id: 1, home: 'Flamengo', away: 'Palmeiras', minute: '65' },
        { id: 2, home: 'Barcelona', away: 'Real Madrid', minute: '30' },
      ]);
      setLoading(false);
    }, 1500);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      
      <header className="w-full border-b border-border p-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Jogos Ao Vivo</h1>
        <Link to="/" className="text-sm text-primary hover:underline">
          Voltar
        </Link>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">

        {loading && (
          <div className="text-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              Carregando jogos ao vivo...
            </p>
          </div>
        )}

        {!loading && matches.length === 0 && (
          <div className="text-center py-20">
            <p className="text-muted-foreground">
              Não há jogos ao vivo agora.
            </p>
          </div>
        )}

        {!loading && matches.length > 0 && (
          <div className="grid gap-4">
            {matches.map((match) => (
              <div
                key={match.id}
                className="p-4 rounded-xl border border-border bg-card"
              >
                <p className="font-semibold">
                  {match.home} vs {match.away}
                </p>
                <p className="text-sm text-muted-foreground">
                  Minuto: {match.minute}'
                </p>
              </div>
            ))}
          </div>
        )}

      </main>
    </div>
  );
};

export default Live;
