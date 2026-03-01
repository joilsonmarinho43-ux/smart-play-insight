import { useState } from 'react';
import { mockMatches } from '@/data/mockMatches';
import MatchCard from '@/components/MatchCard';
import { Calendar, Brain, BarChart3 } from 'lucide-react';

const Index = () => {
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Brain className="w-7 h-7 text-primary" />
            <div>
              <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-wider leading-none">
                ANALISTA PRO 8.0
              </h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground tracking-widest uppercase">
                Modelo Híbrido Ponderado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-primary" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-foreground text-sm outline-none"
            />
          </div>
        </div>
      </header>

      {/* Subtitle bar */}
      <div className="bg-primary/5 border-b border-primary/10">
        <div className="container max-w-3xl mx-auto px-4 py-2.5 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-xs sm:text-sm text-primary font-medium">
            {formatDateDisplay(date)} — {mockMatches.length} jogos analisados
          </span>
        </div>
      </div>

      {/* Match cards */}
      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
        {mockMatches.map((match, i) => (
          <div key={match.id} style={{ animationDelay: `${i * 150}ms` }}>
            <MatchCard match={match} />
          </div>
        ))}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <p className="text-center text-xs text-muted-foreground">
          Estatística Histórica + Forma Recente + Ajuste Casa/Fora
        </p>
      </footer>
    </div>
  );
};

export default Index;
