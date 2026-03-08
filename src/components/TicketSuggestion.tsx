import { useState } from 'react';
import { MatchData, RiskProfile, MarketAnalysis } from '@/types/match';
import { analyzeMarkets, getBestMarketForProfile } from '@/lib/matchAnalysis';
import { Ticket, TrendingUp, AlertTriangle, Zap, Trophy, ChevronDown, ChevronUp, ShieldCheck, Target, Flame, CheckCircle2, XCircle } from 'lucide-react';

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

const COMBO_THRESHOLD = 85;

function getComboSignal(allMarkets: MarketAnalysis[]) {
  const over25 = allMarkets.find(m => m.market === 'Over 2.5 Gols');
  const over75 = allMarkets.find(m => m.market === 'Over 7.5 Escanteios');
  const goalsOk = over25 && over25.probability >= COMBO_THRESHOLD;
  const cornersOk = over75 && over75.probability >= COMBO_THRESHOLD;
  return { over25, over75, goalsOk, cornersOk, isGood: goalsOk && cornersOk };
}

const TicketSuggestionCard = ({ match }: Props) => {
  const [profile, setProfile] = useState<RiskProfile>('conservador');
  const [showAll, setShowAll] = useState(false);

  const allMarkets = analyzeMarkets(match);
  const cfg = profileConfig[profile];
  const bestMarket = getBestMarketForProfile(allMarkets, profile);
  const eligibleMarkets = allMarkets.filter(m => m.probability >= cfg.min);
  const combo = getComboSignal(allMarkets);

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 sm:p-5 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Ticket className="w-5 h-5 text-accent" />
          <h3 className="font-display text-base sm:text-lg text-accent tracking-wide">
            SUGESTÃO DE BILHETE
          </h3>
        </div>
      </div>

      {/* Combo Signal Banner */}
      <ComboSignalBanner combo={combo} />

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

      {/* Best Market + eligible count */}
      <div key={profile} className="animate-fade-in">
        {bestMarket ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Melhor entrada para perfil <span className={cfg.colorClass}>{cfg.label}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">
                {eligibleMarkets.length} mercado{eligibleMarkets.length !== 1 ? 's' : ''} elegível{eligibleMarkets.length !== 1 ? 'eis' : ''}
              </span>
            </div>
            <BestMarketDisplay market={bestMarket} profile={profile} />
            {eligibleMarkets.length > 1 && (
              <div className="mt-2 space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Outras entradas válidas:</span>
                {eligibleMarkets.slice(1, 4).map((m, i) => (
                  <MarketRow key={i} market={m} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="p-4 rounded-lg border border-border bg-muted/30 text-center">
            <p className="text-sm text-muted-foreground font-medium">
              Sem entrada de valor estatístico para o perfil <span className={cfg.colorClass}>{cfg.label}</span>.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Nenhum mercado atingiu {cfg.min}% de probabilidade modelada.
            </p>
          </div>
        )}
      </div>

      {/* Toggle all markets */}
      <button
        onClick={() => setShowAll(!showAll)}
        className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
      >
        {showAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showAll ? 'Ocultar análise completa' : 'Ver todos os mercados analisados'}
      </button>

      {/* All Markets Table */}
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

function ComboSignalBanner({ combo }: { combo: ReturnType<typeof getComboSignal> }) {
  const goalsProb = combo.over25?.probability ?? 0;
  const cornersProb = combo.over75?.probability ?? 0;

  if (combo.isGood) {
    return (
      <div className="mb-4 p-3 rounded-lg border border-green-500/40 bg-green-500/10 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-green-400">✅ JOGO BOM para Over 2.5 Gols + Over 7.5 Escanteios</p>
          <div className="flex gap-4 mt-1.5">
            <span className="text-xs text-green-300/80">Over 2.5 Gols: <strong>{goalsProb}%</strong></span>
            <span className="text-xs text-green-300/80">Over 7.5 Escanteios: <strong>{cornersProb}%</strong></span>
          </div>
          <p className="text-[10px] text-green-300/60 mt-1">Ambos acima de {COMBO_THRESHOLD}% — sinal forte</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 flex items-start gap-3">
      <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-bold text-red-400">❌ NÃO RECOMENDADO para Over 2.5 + Over 7.5 combo</p>
        <div className="flex gap-4 mt-1.5">
          <span className={`text-xs ${combo.goalsOk ? 'text-green-300/80' : 'text-red-300/80'}`}>
            Over 2.5 Gols: <strong>{goalsProb}%</strong> {combo.goalsOk ? '✓' : '✗'}
          </span>
          <span className={`text-xs ${combo.cornersOk ? 'text-green-300/80' : 'text-red-300/80'}`}>
            Over 7.5 Escanteios: <strong>{cornersProb}%</strong> {combo.cornersOk ? '✓' : '✗'}
          </span>
        </div>
        <p className="text-[10px] text-red-300/60 mt-1">Mínimo exigido: {COMBO_THRESHOLD}% em ambos</p>
      </div>
    </div>
  );
}

function BestMarketDisplay({ market, profile }: { market: MarketAnalysis; profile: RiskProfile }) {
  const Icon = categoryIcons[market.category] || Ticket;
  return (
    <div className="p-4 rounded-lg border border-accent/40 bg-accent/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-accent shrink-0" />
          <div>
            <span className="font-bold text-base sm:text-lg text-foreground">{market.market}</span>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${riskColors[market.risk]}`}>
                Risco {market.risk}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display text-2xl sm:text-3xl text-accent leading-none">
            {market.probability}%
          </div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Prob. Modelada</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2.5 leading-relaxed">
        <span className="font-semibold text-muted-foreground/80">Base:</span> {market.statisticalBasis}
      </p>
    </div>
  );
}

function MarketRow({ market }: { market: MarketAnalysis }) {
  const Icon = categoryIcons[market.category] || Ticket;
  const probColor =
    market.probability >= 75 ? 'text-green-400' :
    market.probability >= 55 ? 'text-yellow-400' :
    'text-red-400';

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-border/50">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{market.market}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-xs px-1.5 py-0.5 rounded border ${riskColors[market.risk]}`}>
          {market.risk}
        </span>
        <span className={`font-bold text-sm ${probColor} w-14 text-right`}>
          {market.probability}%
        </span>
      </div>
    </div>
  );
}

export default TicketSuggestionCard;
