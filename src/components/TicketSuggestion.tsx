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

const TicketSuggestionCard = ({ match }: Props) => {
  const [profile, setProfile] = useState<RiskProfile>('conservador');
  const [showAll, setShowAll] = useState(false);

  const allMarkets = analyzeMarkets(match);
  const cfg = profileConfig[profile];
  const bestMarket = getBestMarketForProfile(allMarkets, profile);
  const eligibleMarkets = allMarkets.filter(m => m.probability >= cfg.min);

  const whatsappText = `📊 *${match.homeTeam} vs ${match.awayTeam}*\n🏆 ${match.league}\n\n` +
    eligibleMarkets.slice(0, 3).map(m => {
      const emoji = m.probability >= 85 ? '🟢🔥' : m.probability >= 75 ? '🟢' : '🟡';
      return `${emoji} ${m.market} → ${m.probability}% (Risco ${m.risk})`;
    }).join('\n') +
    `\n\n🧠 _Modelo Poisson • Últimos 5 jogos reais_`;

  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 sm:p-5 mb-4">
      
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Ticket className="w-5 h-5 text-accent" />
        <h3 className="font-display text-base sm:text-lg text-accent tracking-wide">
          ANÁLISE DE MERCADOS
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
                Outras entradas com valor:
              </span>
              {eligibleMarkets.slice(1, 4).map((m, i) => (
                <MarketRow key={i} market={m} />
              ))}
            </div>
          )}

          {/* WhatsApp */}
          <a
            href={whatsappLink}
            target="_blank"
            className="flex items-center justify-center mt-3 bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-semibold py-2 rounded-lg hover:bg-green-500/30 transition"
          >
            📲 Compartilhar análise
          </a>
        </>
      ) : (
        <div className="p-4 rounded-lg border border-border bg-muted/30 text-center">
          <p className="text-sm text-muted-foreground font-medium">
            Nenhum mercado com valor para o perfil {cfg.label}.
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            Tente um perfil mais agressivo ou aguarde mais dados.
          </p>
        </div>
      )}

      {/* Toggle */}
      <button
        onClick={() => setShowAll(!showAll)}
        className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
      >
        {showAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showAll ? 'Ocultar mercados' : 'Ver todos os mercados'}
      </button>

      {showAll && (
        <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {allMarkets.map((m, i) => (
            <MarketRow key={i} market={m} />
          ))}
        </div>
      )}

      {/* Fonte */}
      <div className="mt-3 pt-2 border-t border-border/30 text-center">
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-widest">
          Modelo Poisson · Dados reais API-Sports · Últimos 5 jogos
        </span>
      </div>
    </div>
  );
};

function BestMarketDisplay({ market }: { market: MarketAnalysis }) {
  const Icon = categoryIcons[market.category] || Ticket;
  const riskStyle = riskColors[market.risk] || riskColors['Médio'];

  return (
    <div className="p-4 rounded-lg border border-accent/40 bg-accent/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-accent" />
          <div>
            <span className="font-bold text-base text-foreground">{market.market}</span>
            <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded border ${riskStyle}`}>
              Risco {market.risk}
            </span>
          </div>
        </div>
        <span className="font-bold text-xl text-accent">{market.probability}%</span>
      </div>
    </div>
  );
}

function MarketRow({ market }: { market: MarketAnalysis }) {
  const riskStyle = riskColors[market.risk] || riskColors['Médio'];
  return (
    <div className="flex justify-between items-center text-xs p-2 border border-border/50 rounded-lg bg-secondary/20">
      <span className="font-medium">{market.market}</span>
      <div className="flex items-center gap-2">
        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${riskStyle}`}>{market.risk}</span>
        <span className="font-bold tabular-nums w-10 text-right">{market.probability}%</span>
      </div>
    </div>
  );
}

export default TicketSuggestionCard;
