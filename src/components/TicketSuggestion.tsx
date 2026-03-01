import { MatchMetrics, TicketSuggestion as TicketType } from '@/types/match';
import { Ticket, TrendingUp, AlertTriangle, Zap } from 'lucide-react';

function generateSuggestions(metrics: MatchMetrics): TicketType[] {
  const suggestions: TicketType[] = [];
  const [hxG, axG] = metrics.xG;
  const totalXG = hxG + axG;
  const [hBig, aBig] = metrics.bigChances;
  const totalBigChances = hBig + aBig;
  const [hFouls, aFouls] = metrics.fouls;
  const totalFouls = hFouls + aFouls;
  const [hCards, aCards] = metrics.yellowCards;
  const totalCards = hCards + aCards;
  const [hCorners, aCorners] = metrics.corners;
  const totalCorners = hCorners + aCorners;

  // Goals suggestion
  if (totalXG >= 2.5 && totalBigChances >= 4) {
    suggestions.push({
      type: 'goals',
      label: `Over 2.5 Gols`,
      reasoning: `xG combinado de ${totalXG.toFixed(2)} e ${totalBigChances} grandes chances criadas indicam jogo aberto.`,
      confidence: totalXG >= 3.0 ? 'alta' : 'média',
    });
  } else if (totalXG < 1.8) {
    suggestions.push({
      type: 'goals',
      label: `Under 2.5 Gols`,
      reasoning: `xG combinado baixo (${totalXG.toFixed(2)}) com poucas chances criadas sugere jogo fechado.`,
      confidence: totalXG < 1.3 ? 'alta' : 'média',
    });
  }

  // Cards suggestion
  if (totalFouls >= 24 || totalCards >= 5) {
    suggestions.push({
      type: 'cards',
      label: `Over 4.5 Cartões`,
      reasoning: `${totalFouls} faltas e ${totalCards} cartões na média recente apontam jogo físico.`,
      confidence: totalCards >= 7 ? 'alta' : 'média',
    });
  }

  // Corners suggestion
  if (totalCorners >= 10) {
    suggestions.push({
      type: 'corners',
      label: `Over 9.5 Escanteios`,
      reasoning: `Projeção de ${totalCorners.toFixed(1)} escanteios com base nas médias ponderadas.`,
      confidence: totalCorners >= 12 ? 'alta' : 'média',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      type: 'combined',
      label: 'Jogo sem valor claro',
      reasoning: 'Estatísticas equilibradas, sem vantagem clara para apostas conservadoras.',
      confidence: 'baixa',
    });
  }

  return suggestions;
}

interface Props {
  metrics: MatchMetrics;
}

const confidenceColors: Record<string, string> = {
  alta: 'bg-accent/20 border-accent text-accent',
  média: 'bg-primary/20 border-primary text-primary',
  baixa: 'bg-muted border-border text-muted-foreground',
};

const typeIcons: Record<string, typeof TrendingUp> = {
  goals: TrendingUp,
  cards: AlertTriangle,
  corners: Zap,
  combined: Ticket,
};

const TicketSuggestionCard = ({ metrics }: Props) => {
  const suggestions = generateSuggestions(metrics);

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 sm:p-5 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Ticket className="w-5 h-5 text-accent" />
        <h3 className="font-display text-lg sm:text-xl text-accent tracking-wide">
          SUGESTÃO DE BILHETE CONSERVADOR
        </h3>
      </div>

      <div className="space-y-3">
        {suggestions.map((s, i) => {
          const Icon = typeIcons[s.type] || Ticket;
          return (
            <div
              key={i}
              className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded-lg border ${confidenceColors[s.confidence]}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="font-bold text-sm sm:text-base">{s.label}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-background/30 uppercase tracking-wider">
                  {s.confidence}
                </span>
              </div>
              <p className="text-xs sm:text-sm opacity-80">{s.reasoning}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TicketSuggestionCard;
