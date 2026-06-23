import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Flame,
  AlertTriangle,
  Target,
  TrendingUp,
  Clock,
  Trophy,
  LineChart,
  Gauge,
  Activity,
  Sparkles,
  Loader2,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MatchReadingV2, MatchContext } from "@/lib/readingEngine";
import type { AnalystReading } from "@/hooks/useMatchReading";
import { BookmakerFinder } from "@/components/BookmakerFinder";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reading: MatchReadingV2 | null;
  loading: boolean;
  homeTeam: string;
  awayTeam: string;
  context?: MatchContext | null;
  analyst?: AnalystReading | null;
  analystLoading?: boolean;
  analystError?: "rate_limited" | "credits_exhausted" | "ai_error" | "parse_fail" | null;
  fallback?: {
    source: string;
    confidence_score: number;
    lowConfidence: boolean;
    missing: string[];
  } | null;
}

const sourceLabel: Record<string, string> = {
  "api-football": "API oficial",
  "thesportsdb": "Fonte alternativa",
  "historical": "Histórico armazenado",
  "mixed": "Fontes combinadas",
  "none": "Sem dados",
};

const missingLabel: Record<string, string> = {
  avg_corners: "média de escanteios",
  avg_cards: "média de cartões",
  avg_goals: "média de gols",
  avg_goals_for: "gols marcados",
  avg_goals_against: "gols sofridos",
  xg: "xG (gols esperados)",
  xg_for: "xG ofensivo",
  xg_against: "xG defensivo",
  possession: "posse de bola",
  shots: "finalizações",
  shots_on_target: "chutes ao gol",
  form: "forma recente",
  h2h: "confrontos diretos",
  injuries: "desfalques",
  lineups: "escalações",
  referee: "árbitro",
  weather: "clima",
};

const formatMissing = (k: string) =>
  missingLabel[k] ?? k.replace(/_/g, " ").toLowerCase();

function ConfidenceBadge({
  fallback,
  readingComplete,
}: {
  fallback: NonNullable<Props["fallback"]>;
  readingComplete: boolean;
}) {
  const { confidence_score, source, lowConfidence, missing } = fallback;
  // Oculta quando: não há dado real (none/0), API oficial fresca, ou leitura
  // interna já está completa (fallback é apenas enriquecimento).
  if (source === "none" || confidence_score <= 0) return null;
  if (confidence_score >= 100) return null;
  if (readingComplete && confidence_score < 80) return null;

  const cls = lowConfidence
    ? "bg-red-500/15 text-red-300 border-red-500/40"
    : confidence_score >= 90
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
      : "bg-amber-500/15 text-amber-300 border-amber-500/40";
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] ${cls}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider">
          Confiança {confidence_score}%
        </span>
        <span className="opacity-80">{sourceLabel[source] ?? source}</span>
      </div>
      {lowConfidence && (
        <div className="mt-1 opacity-90">
          Dados parciais — leitura conservadora.
        </div>
      )}
      {!lowConfidence && missing && missing.length > 0 && (
        <div className="mt-1 opacity-75">
          Sem dado para: {missing.slice(0, 3).map(formatMissing).join(", ")}
          {missing.length > 3 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

const Section = ({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="bg-secondary/40 border border-border rounded-xl p-3.5">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-4 h-4 text-primary" />
      <h3 className="text-xs uppercase tracking-wider font-bold text-foreground">
        {title}
      </h3>
    </div>
    <div className="text-[15px] text-foreground leading-relaxed">{children}</div>
  </div>
);

const predBadge = {
  verde: { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "🟢 Jogo previsível" },
  amarelo: { color: "bg-amber-500/20 text-amber-300 border-amber-500/40", label: "🟡 Jogo sensível" },
  vermelho: { color: "bg-red-500/20 text-red-300 border-red-500/40", label: "🔴 Mercado perigoso" },
};

const qualityBadge = {
  completo: "bg-emerald-500/20 text-emerald-300",
  parcial: "bg-amber-500/20 text-amber-300",
  limitado: "bg-red-500/20 text-red-300",
};

function buildShareText(reading: MatchReadingV2, homeTeam: string, awayTeam: string) {
  const top = reading.opportunities
    .slice(0, 3)
    .map((o, i) => `${i + 1}. ${o.market} — ${o.confidence}%`)
    .join("\n");
  const scores = reading.likelyScores.slice(0, 3).join(" · ");
  return [
    `📖 Leitura do Jogo`,
    `${homeTeam} vs ${awayTeam}`,
    ``,
    `📝 ${reading.summary}`,
    ``,
    `🔥 Oportunidades:`,
    top,
    ``,
    `🎯 Placares prováveis: ${scores}`,
    ``,
    `📌 ${reading.verdict}`,
    ``,
    `— Analista Joilson`,
  ].join("\n");
}

const ShareButton = ({
  reading,
  homeTeam,
  awayTeam,
}: {
  reading: MatchReadingV2;
  homeTeam: string;
  awayTeam: string;
}) => {
  const handleShare = async () => {
    const text = buildShareText(reading, homeTeam, awayTeam);
    const title = `Leitura: ${homeTeam} vs ${awayTeam}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success("Leitura copiada para a área de transferência");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        toast.success("Leitura copiada");
      } catch {
        toast.error("Não foi possível compartilhar");
      }
    }
  };

  return (
    <button
      onClick={handleShare}
      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:opacity-95 transition-opacity"
    >
      <Share2 className="w-4 h-4" />
      Compartilhar leitura
    </button>
  );
};

const movementMeta = {
  down: { icon: "📉", label: "queda", cls: "text-emerald-400" },
  up: { icon: "📈", label: "alta", cls: "text-red-400" },
  flat: { icon: "•", label: "estável", cls: "text-muted-foreground" },
} as const;

const OddBox = ({
  flag,
  name,
  odd,
  move,
  open,
  accent,
}: {
  flag: string;
  name: string;
  odd: number | null;
  move?: "up" | "down" | "flat";
  open?: number | null;
  accent?: boolean;
}) => {
  if (!odd) {
    return (
      <div className="flex-1 rounded-lg bg-secondary/40 border border-border p-2.5 text-center">
        <div className="text-[10px] uppercase text-muted-foreground truncate">{flag} {name}</div>
        <div className="font-display text-lg text-muted-foreground">—</div>
      </div>
    );
  }
  // Só considera "movimento" quando há drift real (>= 1 centésimo) entre abertura e atual.
  const hasRealDrift =
    !!open && Math.abs(open - odd) >= 0.01 && move && move !== "flat";
  const m = hasRealDrift ? movementMeta[move!] : null;
  return (
    <div
      className={`flex-1 rounded-lg p-2.5 text-center border ${
        accent
          ? "bg-primary/10 border-primary/50"
          : "bg-secondary/60 border-border"
      }`}
    >
      <div className="text-[10px] uppercase text-muted-foreground truncate">
        {flag} {name}
      </div>
      <div className="font-display text-lg font-bold text-foreground leading-tight">
        {odd.toFixed(2)}
      </div>
      {m && open && (
        <div className={`text-[10px] ${m.cls} leading-none mt-0.5`}>
          {m.icon} de {open.toFixed(2)}
        </div>
      )}
    </div>
  );
};

const OddsPanel = ({
  context,
  homeTeam,
  awayTeam,
}: {
  context?: MatchContext | null;
  homeTeam: string;
  awayTeam: string;
}) => {
  const odds = context?.odds;
  if (!odds || (!odds.home && !odds.draw && !odds.away)) return null;

  const fav =
    odds.home && odds.away
      ? odds.home < odds.away
        ? "home"
        : odds.away < odds.home
          ? "away"
          : null
      : null;

  return (
    <div className="bg-secondary/40 border border-primary/30 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider font-bold text-primary">
            📊 Mercado 1X2
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {odds.meta?.sourceLabel || "Mercado ao vivo"}
        </span>
      </div>
      <div className="flex gap-2">
        <OddBox
          flag="🏠"
          name={homeTeam}
          odd={odds.home}
          move={odds.movement?.home}
          open={odds.opening?.home}
          accent={fav === "home"}
        />
        <OddBox
          flag="🤝"
          name="Empate"
          odd={odds.draw}
          move={odds.movement?.draw}
          open={odds.opening?.draw}
        />
        <OddBox
          flag="✈"
          name={awayTeam}
          odd={odds.away}
          move={odds.movement?.away}
          open={odds.opening?.away}
          accent={fav === "away"}
        />
      </div>
      {(odds.over25 || odds.under25 || odds.bttsYes) && (
        <div className="flex gap-2 mt-2">
          {odds.over25 && (
            <OddBox
              flag="⚽"
              name="Over 2.5"
              odd={odds.over25}
              move={odds.movement?.over25}
              open={odds.opening?.over25}
            />
          )}
          {odds.under25 && (
            <OddBox flag="🛡" name="Under 2.5" odd={odds.under25} />
          )}
          {odds.bttsYes && (
            <OddBox flag="🎯" name="BTTS Sim" odd={odds.bttsYes} />
          )}
        </div>
      )}
    </div>
  );
};



const riscoBadge = {
  baixo: { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "Risco baixo" },
  medio: { color: "bg-amber-500/20 text-amber-300 border-amber-500/40", label: "Risco moderado" },
  alto: { color: "bg-red-500/20 text-red-300 border-red-500/40", label: "Risco alto" },
} as const;

const AnalystBlock = ({
  analyst,
  loading,
}: {
  analyst?: AnalystReading | null;
  loading?: boolean;
}) => {
  if (!analyst && !loading) return null;
  return (
    <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-xs uppercase tracking-wider font-bold text-primary">
            Análise do Especialista
          </h3>
        </div>
        {analyst && (
          <span
            className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${riscoBadge[analyst.risco].color}`}
          >
            {riscoBadge[analyst.risco].label}
          </span>
        )}
      </div>
      {loading && !analyst && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Cruzando estatísticas com contexto real...
        </div>
      )}
      {analyst && (
        <div className="space-y-3 text-[16px] leading-7 text-foreground">
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-primary block mb-1">
              Cenário
            </span>
            <p>{analyst.cenario}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider font-bold text-amber-300 block mb-1">
              Ponto de Atenção
            </span>
            <p>{analyst.pontoAtencao}</p>
          </div>

          {analyst.contextoDetalhado && (
            <div className="rounded-lg border border-border bg-background/70 p-3 space-y-2">
              <span className="text-xs uppercase tracking-wider font-bold text-primary block">
                Contexto Detalhado
              </span>
              {analyst.contextoDetalhado.desfalques && (
                <p><span className="font-bold text-primary">Desfalques:</span> {analyst.contextoDetalhado.desfalques}</p>
              )}
              {analyst.contextoDetalhado.arbitro && (
                <p><span className="font-bold text-primary">Árbitro:</span> {analyst.contextoDetalhado.arbitro}</p>
              )}
              {analyst.contextoDetalhado.clima && (
                <p><span className="font-bold text-primary">Clima:</span> {analyst.contextoDetalhado.clima}</p>
              )}
              {analyst.contextoDetalhado.motivacao && (
                <p><span className="font-bold text-primary">Motivação:</span> {analyst.contextoDetalhado.motivacao}</p>
              )}
            </div>
          )}

          {analyst.mercados && (
            <div className="rounded-lg border border-primary/40 bg-background/70 p-3 space-y-2">
              <span className="text-xs uppercase tracking-wider font-bold text-primary block">
                Análise por Mercado
              </span>
              {analyst.mercados.vitoria && (<p><span className="font-bold text-primary">Vitória (1X2):</span> {analyst.mercados.vitoria}</p>)}
              {analyst.mercados.duplaChance && (<p><span className="font-bold text-primary">Dupla Chance:</span> {analyst.mercados.duplaChance}</p>)}
              {analyst.mercados.handicap && (<p><span className="font-bold text-primary">Handicap Asiático:</span> {analyst.mercados.handicap}</p>)}
              {analyst.mercados.overUnderGols && (<p><span className="font-bold text-primary">Over/Under Gols:</span> {analyst.mercados.overUnderGols}</p>)}
              {analyst.mercados.btts && (<p><span className="font-bold text-primary">Ambas Marcam:</span> {analyst.mercados.btts}</p>)}
              {analyst.mercados.escanteios && (<p><span className="font-bold text-primary">Escanteios:</span> {analyst.mercados.escanteios}</p>)}
              {analyst.mercados.cartoes && (<p><span className="font-bold text-primary">Cartões:</span> {analyst.mercados.cartoes}</p>)}
              {analyst.mercados.placarExato && (<p><span className="font-bold text-primary">Placar Provável:</span> {analyst.mercados.placarExato}</p>)}
            </div>
          )}

          {analyst.oddsReferencia && Object.values(analyst.oddsReferencia).some(Boolean) && (
            <div className="rounded-lg border border-primary/40 bg-background/80 p-3">
              <span className="text-xs uppercase tracking-wider font-bold text-primary block mb-2">
                Odds Justas Estimadas
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[15px]">
                {analyst.oddsReferencia.casa && (<div className="flex justify-between gap-2"><span className="text-foreground/90">Casa:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.casa}</span></div>)}
                {analyst.oddsReferencia.empate && (<div className="flex justify-between gap-2"><span className="text-foreground/90">Empate:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.empate}</span></div>)}
                {analyst.oddsReferencia.fora && (<div className="flex justify-between gap-2"><span className="text-foreground/90">Fora:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.fora}</span></div>)}
                {analyst.oddsReferencia.over25 && (<div className="flex justify-between gap-2"><span className="text-foreground/90">Over 2.5:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.over25}</span></div>)}
                {analyst.oddsReferencia.under25 && (<div className="flex justify-between gap-2"><span className="text-foreground/90">Under 2.5:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.under25}</span></div>)}
                {analyst.oddsReferencia.bttsSim && (<div className="flex justify-between gap-2"><span className="text-foreground/90">BTTS Sim:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.bttsSim}</span></div>)}
                {analyst.oddsReferencia.escanteiosOver9 && (<div className="flex justify-between gap-2"><span className="text-foreground/90">Esc. +9.5:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.escanteiosOver9}</span></div>)}
                {analyst.oddsReferencia.cartoesOver4 && (<div className="flex justify-between gap-2"><span className="text-foreground/90">Cart. +4.5:</span> <span className="font-display font-bold text-primary text-[17px]">{analyst.oddsReferencia.cartoesOver4}</span></div>)}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-amber-400/50 bg-amber-500/10 p-3">
            <span className="text-xs uppercase tracking-wider font-bold text-amber-300 block mb-1">
              Veredito de Valor
            </span>
            <p className="font-semibold text-foreground">{analyst.veredito}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export const MatchReadingModal = ({
  open,
  onOpenChange,
  reading,
  loading,
  homeTeam,
  awayTeam,
  context,
  analyst,
  analystLoading,
  analystError,
  fallback,
}: Props) => {
  const readingComplete = !!reading && reading.contextQuality === "completo";
  const analystErrorMessage =
    analystError === "rate_limited"
      ? "Limite temporário da análise por IA atingido. Tente novamente em alguns instantes."
      : analystError === "credits_exhausted"
        ? "Créditos de IA esgotados. A análise por IA está temporariamente indisponível."
        : analystError === "ai_error" || analystError === "parse_fail"
          ? "Não foi possível gerar a análise por IA agora. Os dados estatísticos continuam disponíveis abaixo."
          : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[88vh] overflow-y-auto bg-background border-primary/20 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle className="font-display text-xl tracking-wide">
            📖 Leitura do Jogo
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {homeTeam} <span className="opacity-60">vs</span> {awayTeam}
          </DialogDescription>
          {fallback && (() => {
            const indicatorsText = (reading?.indicators ?? []).join(" ").toLowerCase();
            const coveredByReading: Record<string, boolean> = {
              avg_corners: /escante|canto|corner/.test(indicatorsText),
              avg_goals: typeof reading?.projectedGoals === "number",
              avg_goals_for: /marca\s+\d/.test(indicatorsText),
              avg_goals_against: /sofre\s+\d/.test(indicatorsText),
              home_form: /\b(últimas|forma)\b/.test(indicatorsText),
              away_form: /\b(últimas|forma)\b/.test(indicatorsText),
            };
            const filteredMissing = (fallback.missing || []).filter(
              (k) => !coveredByReading[k],
            );
            return (
              <ConfidenceBadge
                fallback={{ ...fallback, missing: filteredMissing }}
                readingComplete={readingComplete}
              />
            );
          })()}
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">
              Coletando contexto e montando a análise...
            </div>
          </div>
        )}

        {analystErrorMessage && !loading && (
          <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            {analystErrorMessage}
          </div>
        )}

        {!loading && !reading && (analyst || analystLoading) && (
          <div className="space-y-3 mt-2">
            <AnalystBlock analyst={analyst} loading={analystLoading} />
            <div className="text-xs text-muted-foreground text-center px-4 italic">
              Sem histórico estatístico da API para esta partida — leitura gerada por pesquisa externa da IA.
            </div>
            <BookmakerFinder homeTeam={homeTeam} awayTeam={awayTeam} />
          </div>
        )}

        {!loading && !reading && !analyst && !analystLoading && (
          <div className="text-center text-sm text-foreground/80 py-10 px-4">
            <div className="text-foreground font-bold mb-1">
              Dados insuficientes
            </div>
            Esta partida ainda não possui histórico estatístico suficiente para
            gerar uma leitura real.
          </div>

        )}

        {!loading && reading && (
          <div className="space-y-3 mt-2">
            <AnalystBlock analyst={analyst} loading={analystLoading} />

            <ShareButton reading={reading} homeTeam={homeTeam} awayTeam={awayTeam} />

            <OddsPanel context={context} homeTeam={homeTeam} awayTeam={awayTeam} />

            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <span
                className={`px-3 py-1 rounded-lg border text-xs font-bold ${predBadge[reading.predictability].color}`}
              >
                {predBadge[reading.predictability].label}
              </span>
              <span
                className={`px-3 py-1 rounded-lg text-xs font-bold ${qualityBadge[reading.contextQuality]}`}
              >
                Contexto {reading.contextQuality}
              </span>
            </div>

            <Section icon={LineChart} title="Resumo da Partida">
              <p>{reading.summary}</p>
            </Section>

            <Section icon={Activity} title="Leitura Tática">
              <p>{reading.tactical}</p>
            </Section>

            <Section icon={TrendingUp} title="Indicadores Relevantes">
              <ul className="space-y-1">
                {reading.indicators.map((i, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-primary shrink-0">✔</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section icon={Target} title="Leitura do Mercado">
              <p>{reading.marketRead}</p>
            </Section>

            <Section icon={Flame} title="Melhores Oportunidades">
              <div className="space-y-2.5">
                {reading.opportunities.map((op, k) => (
                  <div
                    key={k}
                    className="rounded-lg bg-secondary border border-primary/40 p-3"
                  >
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <span className="font-bold text-foreground text-base">
                        {k === 0 ? "🔥 " : ""}
                        {op.market}
                      </span>
                      <span className="text-sm font-display font-bold px-2 py-0.5 rounded-md bg-primary text-primary-foreground">
                        {op.confidence}%
                      </span>
                    </div>
                    <ul className="text-sm text-foreground/80 space-y-0.5">
                      {op.reasons.map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={AlertTriangle} title="Alertas Importantes">
              <ul className="space-y-1">
                {reading.alerts.map((a, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-primary shrink-0">⚠</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section icon={Trophy} title="Placares Prováveis">
              <div className="flex gap-2 flex-wrap">
                {reading.likelyScores.map((s, k) => (
                  <span
                    key={k}
                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-display font-bold text-base"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Section>

            <Section icon={Target} title="Linhas de Gols (Realistas)">
              <div className="space-y-1.5">
                {reading.goalLines.map((g, k) => {
                  const label = `${g.side === "over" ? "Over" : "Under"} ${g.line.toFixed(1)}`;
                  return (
                    <div
                      key={k}
                      className={`flex items-center justify-between gap-2 rounded-lg p-2.5 border ${
                        g.recommended
                          ? "bg-primary/15 border-primary/60"
                          : "bg-secondary/40 border-border"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground text-sm">
                            {g.recommended ? "✅ " : ""}{label}
                          </span>
                          {g.recommended && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-bold">
                              Recomendado
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-foreground/70 mt-0.5">{g.rationale}</div>
                      </div>
                      <span className="font-display font-bold text-base px-2 py-0.5 rounded-md bg-primary text-primary-foreground shrink-0">
                        {g.probability}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section icon={Clock} title="Timing da Partida">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-xs uppercase text-foreground/60 tracking-wider mr-2">
                    Início:
                  </span>
                  {reading.timing.opening}
                </div>
                <div>
                  <span className="text-xs uppercase text-foreground/60 tracking-wider mr-2">
                    Maior pressão:
                  </span>
                  <span className="font-display text-foreground">
                    {reading.timing.pressure}
                  </span>
                </div>
                <div>
                  <span className="text-xs uppercase text-foreground/60 tracking-wider mr-2">
                    Aceleração:
                  </span>
                  <span className="font-display text-foreground">
                    {reading.timing.acceleration}
                  </span>
                </div>
              </div>
            </Section>

            <Section icon={Gauge} title="Projeções Matemáticas">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm">⚽ Gols projetados:</span>
                <span className="font-display text-lg text-primary font-bold">
                  {reading.projectedGoals.toFixed(1)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground self-center mr-1">📈 Tendência:</span>
                {reading.trendTags.map((t, k) => (
                  <span
                    key={k}
                    className="px-2 py-0.5 rounded-md bg-primary/15 text-primary text-xs font-bold border border-primary/30"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Section>

            <Section icon={Sparkles} title="💡 Insight Premium">
              <p className="italic text-foreground/90">{reading.premiumInsight}</p>
            </Section>

            <Section icon={Sparkles} title="🧠 Leitura Final">
              <p className="font-medium text-foreground">{reading.verdict}</p>
            </Section>

            <div className="text-right text-xs text-muted-foreground italic pt-1">
              {reading.signature}
            </div>

            <BookmakerFinder homeTeam={homeTeam} awayTeam={awayTeam} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
