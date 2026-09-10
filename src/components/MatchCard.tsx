import { useMemo } from 'react';
import { BarChart3, Clock, Database, ShieldAlert, Target, TrendingUp, CheckCircle2 } from 'lucide-react';
import type { MatchData } from '@/types/match';

interface Props { match: MatchData; isPremium?: boolean; }
function fmt(value: number | null | undefined, digits = 1): string { return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'; }

function SampleBadge({ match }: { match: MatchData }) {
  const sample = match.sampleSize;
  if (!sample) return <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive"><ShieldAlert className="h-3 w-3" /> Dados insuficientes</span>;
  const minimum = Math.min(sample.homeGames, sample.awayGames);
  const label = minimum >= 5 ? 'Amostra adequada' : minimum >= 3 ? 'Amostra limitada' : 'Amostra insuficiente';
  const tone = minimum >= 5 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : minimum >= 3 ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-destructive/30 bg-destructive/10 text-destructive';
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${tone}`}><Database className="h-3 w-3" /> {label} · {sample.homeGames}/{sample.awayGames} jogos</span>;
}

function MetricRow({ label, home, away, suffix = '' }: { label: string; home: number | null | undefined; away: number | null | undefined; suffix?: string }) {
  const hasHome = Number.isFinite(home); const hasAway = Number.isFinite(away);
  if (!hasHome && !hasAway) return null;
  return <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border/20 py-2 last:border-0"><span className="text-right text-xs font-semibold tabular-nums">{hasHome ? `${fmt(home)}${suffix}` : '—'}</span><span className="text-[10px] text-muted-foreground">{label}</span><span className="text-xs font-semibold tabular-nums">{hasAway ? `${fmt(away)}${suffix}` : '—'}</span></div>;
}

export default function MatchCard({ match }: Props) {
  const metrics = match.metrics;
  const model = match.modelData;
  const modelAvailability = useMemo(() => Number.isFinite(model?.homeGoalsAvg) && Number.isFinite(model?.awayGoalsAvg), [model]);
  const predictions = match.predictions;
  const coreReady = predictions?.probabilitySource === 'MODEL_ESTIMATE' && predictions.calibrationStatus === 'CALIBRATED';

  return <article className="rounded-2xl border border-border/50 bg-card/80 p-4 shadow-sm transition-colors hover:border-border">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{match.league}</p><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /><span>{match.time}</span>{match.isLive && <span className="font-semibold text-emerald-400">AO VIVO {match.minute != null ? `· ${match.minute}'` : ''}</span>}</div></div><SampleBadge match={match} /></div>
    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="text-right text-sm font-bold break-words">{match.homeTeam}</div><div className="rounded-lg bg-secondary/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground">{match.isLive && match.liveScore ? `${match.liveScore.home}–${match.liveScore.away}` : 'VS'}</div><div className="text-sm font-bold break-words">{match.awayTeam}</div></div>
    <div className="mt-4 rounded-xl border border-border/30 bg-secondary/20 p-3"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><BarChart3 className="h-3.5 w-3.5" /> Estatísticas observadas</div>{metrics ? <><MetricRow label="Posse" home={metrics.possession?.[0]} away={metrics.possession?.[1]} suffix="%" /><MetricRow label="Finalizações" home={metrics.totalShots?.[0]} away={metrics.totalShots?.[1]} /><MetricRow label="No alvo" home={metrics.shotsOnTarget?.[0]} away={metrics.shotsOnTarget?.[1]} /><MetricRow label="Grandes chances" home={metrics.bigChances?.[0]} away={metrics.bigChances?.[1]} /><MetricRow label="Escanteios" home={metrics.corners?.[0]} away={metrics.corners?.[1]} /><MetricRow label="Cartões" home={metrics.yellowCards?.[0]} away={metrics.yellowCards?.[1]} /></> : <p className="text-xs text-muted-foreground">Estatísticas observadas não disponíveis.</p>}</div>
    <div className="mt-3 rounded-xl border border-border/30 bg-secondary/20 p-3"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><Target className="h-3.5 w-3.5" /> Modelo estatístico</div>{modelAvailability ? <div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-background/40 p-2"><span className="text-muted-foreground">Gols médios casa</span><div className="mt-1 font-bold tabular-nums">{fmt(model?.homeGoalsAvg)}</div></div><div className="rounded-lg bg-background/40 p-2"><span className="text-muted-foreground">Gols médios fora</span><div className="mt-1 font-bold tabular-nums">{fmt(model?.awayGoalsAvg)}</div></div></div> : <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> Sem amostra suficiente para uma estimativa de modelo.</div>}<p className="mt-2 text-[10px] text-muted-foreground">Grandes chances são exibidas como estatística observada e nunca são tratadas como xG.</p></div>
    <div className={`mt-3 rounded-xl border p-3 ${coreReady ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-primary/20 bg-primary/5'}`}>
      <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Nexus Core</p>{coreReady && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Calibrado</span>}</div>
      {coreReady ? <p className="mt-1 text-xs font-semibold">Casa {predictions?.homeWin}% · Empate {predictions?.draw}% · Fora {predictions?.awayWin}%</p> : <><p className="mt-1 text-xs font-semibold text-amber-300">Decisão oficial indisponível</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">A interface só exibe uma probabilidade oficial quando a origem é modelo e a calibração está validada. Dados sem essa garantia permanecem informativos.</p></>}
    </div>
  </article>;
}
