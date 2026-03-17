import { useState } from 'react';
import { MatchData, RiskProfile, MarketAnalysis } from '@/types/match';
import { analyzeMarkets, getBestMarketForProfile } from '@/lib/matchAnalysis';
import { Ticket, TrendingUp, AlertTriangle, Zap, Trophy, ChevronDown, ChevronUp, ShieldCheck, Target, Flame } from 'lucide-react';

interface Props {
  match: MatchData;
}

const profileConfig: Record<RiskProfile, { label: string; min: number; icon: typeof ShieldCheck; colorClass: string }> = {
  conservador: { label: 'Conservador', min: 75, icon: ShieldCheck, colorClass: 'text-green-400' },
  moderado: { label: 'Moderado', min: 65, icon: Target, colorClass: 'text-yellow-400' },
  agressivo: { label: 'Agressivo', min: 55, icon: Flame, colorClass: 'text-red-400' },
};

const categoryIcons: Record<string, typeof TrendingUp> = {
  goals: TrendingUp,
  corners: Zap,
  cards: AlertTriangle,
  result: Trophy,
};

const riskColors: Record<string, string> = {
  'Baixo': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Médio': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Alto': 'bg-red-500/20 text-red-400 border-red-500/30',
};

// 💰 Função EV e bilhete real
function calculateEV(prob: number, odd: number) {
  return prob / 100 * odd - 1;
}

function generateEVTicket(markets: MarketAnalysis[], stakeBase: number = 10) {
  // Filtra apenas mercados com odd disponível e EV positivo
  const evMarkets = markets
    .filter(m => m.odd && calculateEV(m.probability, m.odd) > 0)
    .sort((a, b) => calculateEV(b.probability, b.odd) - calculateEV(a.probability, a.odd)) // do maior EV
    .slice(0, 3);

  return evMarkets.map(m => ({
    market: m.market,
    prob: m.probability,
    odd: m.odd!,
    ev: parseFloat(calculateEV(m.probability, m.odd!).toFixed(2)),
    suggestedStake: parseFloat((stakeBase * calculateEV(m.probability, m.odd!)).toFixed(2)),
  }));
}

const TicketSuggestionCard = ({ match }: Props) => {
  const [profile, setProfile] = useState<RiskProfile>('conservador');
  const [showAll, setShowAll] = useState(false);

  const allMarkets = analyzeMarkets(match);
  const cfg = profileConfig[profile];
  const bestMarket = getBestMarketForProfile(allMarkets, profile);
  const eligibleMarkets = allMarkets.filter(m => m.probability >= cfg.min);

  const evTicket = generateEVTicket(eligibleMarkets, 10);

  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(
    `📊 ${match.homeTeam} vs ${match.awayTeam}\n\n` +
    evTicket.map(t => `✅ ${t.market} (${t.prob}%) - Odd: ${t.odd} - EV: ${t.ev} - Stake $${t.suggestedStake}`).join('\n') +
    `\n📈 Análise modelada`
  )}`;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 sm:p-5 mb-4">
      
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Ticket className="w-5 h-5 text-accent" />
        <h3 className="font-display text-base sm:text-lg text-accent tracking-wide">
          SUGESTÃO DE BILHETE PROFISSIONAL
        </h3>
      </div>

      {/* Profile Selector */}
      <div className="grid grid-cols-3 gap-1.5 sm:flex sm:gap-2 mb-4">
        {(Object.keys(profileConfig) as RiskProfile[]).map((p) => {
          const c = profileConfig[p];
          const Icon = c.icon;
          const active = profile === p;
          return (
            <button
              key={p}
              onClick={() => setProfile(p)}
              className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-all border ${
                active
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-secondary/50 border-border text-muted-foreground hover:border-accent/40'
              }`}
            >
              <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="truncate">{c.label}</span>
              <span className="opacity-60 hidden sm:inline">≥{c.min}%</span>
            </button>
          );
        })}
      </div>

      {/* Best Market */}
      {bestMarket ? (
        <>
          <BestMarketDisplay market={bestMarket} />

          {eligibleMarkets.length > 1 && (
            <div className="mt-2 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Outras entradas válidas:
              </span>
              {eligibleMarkets.slice(1, 4).map((m, i) => (
                <MarketRow key={i} market={m} />
              ))}
            </div>
          )}

          {/* Bilhete profissional EV */}
          <div className="mt-4 p-3 border rounded-lg bg-accent/10">
            <h4 className="font-semibold text-sm mb-2">💹 Bilhete Profissional (EV+)</h4>
            {evTicket.map((t, i) => (
              <div key={i} className="flex justify-between text-xs py-1">
                <span>{t.market}</span>
                <span>{t.prob}%</span>
                <span>Odd: {t.odd}</span>
                <span>EV: {t.ev}</span>
                <span>Stake: ${t.suggestedStake}</span>
              </div>
            ))}
          </div>

          {/* Botão WhatsApp */}
          <a
            href={whatsappLink}
            target="_blank"
            className="flex items-center justify-center mt-3 bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-semibold py-2 rounded-lg hover:bg-green-500/30 transition"
          >
            📲 Enviar bilhete EV+ no WhatsApp
          </a>
        </>
      ) : (
        <div className="p-4 rounded-lg border border-border bg-muted/30 text-center">
          <p className="text-sm text-muted-foreground font-medium">
            Sem entrada de valor estatístico para este perfil.
          </p>
        </div>
      )}

      {/* Toggle */}
      <button
        onClick={() => setShowAll(!showAll)}
        className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
      >
        {showAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showAll ? 'Ocultar análise completa' : 'Ver todos os mercados'}
      </button>

      {showAll && (
        <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {allMarkets.map((m, i) => (
            <MarketRow key={i} market={m} />
          ))}
        </div>
      )}
    </div>
  );
};

function BestMarketDisplay({ market }: { market: MarketAnalysis }) {
  const Icon = categoryIcons[market.category] || Ticket;

  return (
    <div className="p-4 rounded-lg border border-accent/40 bg-accent/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-accent" />
          <span className="font-bold text-base text-foreground">{market.market}</span>
        </div>
        <span className="font-bold text-xl text-accent">{market.probability}%</span>
      </div>
    </div>
  );
}

function MarketRow({ market }: { market: MarketAnalysis }) {
  return (
    <div className="flex justify-between text-xs p-2 border rounded">
      <span>{market.market}</span>
      <span>{market.probability}%</span>
    </div>
  );
}

export default TicketSuggestionCard;
