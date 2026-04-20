/**
 * LIVE TRADER PRO — Dashboard profissional estilo "trading esportivo"
 * Mantém todas as regras de negócio existentes; apenas reorganiza a apresentação.
 * Responsivo: 1 coluna (mobile) → 2 colunas (tablet) → 3 colunas (desktop)
 */
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Loader2, RefreshCw, Zap, TrendingUp, AlertTriangle, Target, Activity,
  ChevronDown, ChevronUp, Flame, Star, ArrowLeft, Bot, Wallet, BarChart3,
  CheckCircle2, XCircle, Circle, Volume2, VolumeX, Check, X, RotateCcw,
} from 'lucide-react';
import { fetchLiveMatches } from '@/services/footballApi';
import { analyzeLivePressure, generateLiveStrategy, recordPISnapshot, type PressureData, type PISnapshot, type LiveStrategy } from '@/lib/pressureEngine';
import { calculateAPWindows, calculateLiveOddsDeviation, projectCornersByPeriod, type AttackPressureWindows, type OddsDeviation, type CornerPeriod } from '@/lib/eliteMetrics';
import { classifyHybridSignal, type HybridSignal } from '@/lib/hybridEngine';
import { analyzeSniperSignal, type SniperSignal } from '@/lib/sniperEngine';
import { useHybridPerformance } from '@/hooks/useHybridPerformance';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import MomentumChart from '@/components/MomentumChart';
import CornerTimeline from '@/components/CornerTimeline';
import OverGoalsPanel from '@/components/OverGoalsPanel';

interface PoissonProbs {
  over05: number;
  over15: number;
  over25: number;
  over35: number;
  expectedGoals: number;
  /** Markets already achieved — UI should show "Concluído" */
  completed: Set<string>;
}

function factorial(n: number): number { if (n <= 1) return 1; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poissonPMF(l: number, k: number) { if (l <= 0) return k === 0 ? 1 : 0; return (Math.pow(l, k) * Math.exp(-l)) / factorial(k); }

/**
 * Calcula probabilidade de MAIS gols acontecerem no tempo restante.
 * Para mercados já batidos retorna -1 (sinaliza "Concluído").
 */
function poissonOverFuture(lambda: number, threshold: number, currentTotal: number): number {
  const need = Math.max(0, Math.ceil(threshold) - currentTotal);
  if (need <= 0) return -1; // Mercado já concluído
  let cdf = 0;
  for (let k = 0; k <= need - 1; k++) cdf += poissonPMF(lambda, k);
  return Math.max(1, Math.min(99, Math.round((1 - cdf) * 100)));
}

function calculatePoisson(homeStats: any, awayStats: any, minute: number, totalGoals: number): PoissonProbs {
  const h = homeStats || {};
  const a = awayStats || {};
  const safeMin = Math.max(minute, 1);
  const remaining = Math.max(90 - minute, 1);

  // xG proxy: shots on goal * 0.22 + total shots * 0.08
  const totalSoG = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
  const totalShots = (h.totalShots || 0) + (a.totalShots || 0);
  const xgSoFar = totalSoG * 0.22 + totalShots * 0.08;

  // Project xG for remaining time based on current rate
  const xgPerMin = xgSoFar / safeMin;
  const lambda = Math.max(0.05, xgPerMin * remaining);

  const completed = new Set<string>();
  const raw05 = poissonOverFuture(lambda, 0.5, totalGoals);
  const raw15 = poissonOverFuture(lambda, 1.5, totalGoals);
  const raw25 = poissonOverFuture(lambda, 2.5, totalGoals);
  const raw35 = poissonOverFuture(lambda, 3.5, totalGoals);

  if (raw05 === -1) completed.add('Over 0.5');
  if (raw15 === -1) completed.add('Over 1.5');
  if (raw25 === -1) completed.add('Over 2.5');
  if (raw35 === -1) completed.add('Over 3.5');

  return {
    over05: raw05 === -1 ? 0 : raw05,
    over15: raw15 === -1 ? 0 : raw15,
    over25: raw25 === -1 ? 0 : raw25,
    over35: raw35 === -1 ? 0 : raw35,
    expectedGoals: Math.round((totalGoals + lambda) * 10) / 10,
    completed,
  };
}

interface SignalDecision {
  action: 'ENTRAR' | 'AGUARDAR' | 'AGUARDANDO' | 'BLOQUEADO';
  market: string;
  confidence: number;
  windowText: string;
  strength: 'forte' | 'médio' | 'fraco';
  reason: string;
}

/** Texto descritivo coerente com os dados de pressão reais */
function buildPressureNarrative(homePI: number, awayPI: number, homeName: string, awayName: string): string {
  const total = homePI + awayPI;
  if (total < 1) return 'Sem pressão relevante registrada';
  const homeShare = Math.round((homePI / total) * 100);
  const awayShare = 100 - homeShare;
  const dom = homeShare >= awayShare ? homeName : awayName;
  const share = Math.max(homeShare, awayShare);
  if (share >= 70) return `${dom} dominando (${share}% da pressão)`;
  if (share >= 58) return `${dom} pressionando (${share}% da pressão)`;
  return `Pressão equilibrada (${homeShare}% / ${awayShare}%)`;
}

function buildSignalDecision(
  hybrid: HybridSignal | null,
  sniper: SniperSignal | null,
  topStrategy: LiveStrategy | undefined,
  minute: number,
  pressureNarrative: string,
): SignalDecision {
  const enrich = (base: string) => `${base} • ${pressureNarrative}`;
  if (hybrid && hybrid.tier === 'SNIPER' && hybrid.canExecute) {
    return {
      action: 'ENTRAR', market: hybrid.market, confidence: 85,
      windowText: `${minute}'–${Math.min(minute + 15, 45)}'`,
      strength: 'forte', reason: enrich(hybrid.executionReason),
    };
  }
  if (hybrid && hybrid.tier === 'SEMI' && hybrid.canExecute) {
    return {
      action: 'ENTRAR', market: hybrid.market, confidence: 72,
      windowText: `${minute}'–${Math.min(minute + 20, 60)}'`,
      strength: 'médio', reason: enrich(hybrid.executionReason),
    };
  }
  if (sniper?.canExecute) {
    return {
      action: 'ENTRAR', market: sniper.market, confidence: 78,
      windowText: `${minute}'–${Math.min(minute + 15, 45)}'`,
      strength: 'forte', reason: enrich(sniper.executionReason),
    };
  }
  if (hybrid && !hybrid.canExecute) {
    return {
      action: 'BLOQUEADO', market: hybrid.market, confidence: hybrid.tier === 'SNIPER' ? 80 : 65,
      windowText: '—', strength: 'fraco', reason: enrich(hybrid.executionReason),
    };
  }
  if (topStrategy && topStrategy.signal === 'entry' && topStrategy.confidence >= 60) {
    return {
      action: 'ENTRAR', market: topStrategy.market, confidence: topStrategy.confidence,
      windowText: `${minute}'–${Math.min(minute + 15, 90)}'`,
      strength: topStrategy.confidence >= 75 ? 'forte' : 'médio',
      reason: enrich(topStrategy.reason),
    };
  }
  return {
    action: 'AGUARDAR', market: topStrategy?.market || 'Aguardando padrão',
    confidence: topStrategy?.confidence || 0,
    windowText: '—', strength: 'fraco',
    reason: enrich(topStrategy?.reason || 'Sem sinal de alta confiança no momento'),
  };
}

/** Hook: alerta sonoro quando sinal muda para ENTRADA CONFIRMADA */
function useSignalSound(signalAction: string | undefined) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const prevAction = useRef<string | undefined>(undefined);
  const audioCtx = useRef<AudioContext | null>(null);

  const playBeep = useCallback(() => {
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext();
      const ctx = audioCtx.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn('[SOUND] Falha ao tocar beep:', e);
    }
  }, []);

  useEffect(() => {
    if (!soundEnabled || !signalAction) return;
    const wasWaiting = prevAction.current !== 'ENTRAR';
    const nowEntry = signalAction === 'ENTRAR';
    if (wasWaiting && nowEntry) {
      console.log('[SOUND] 🔔 Sinal mudou para ENTRAR — disparando alerta sonoro');
      playBeep();
      toast.info('🔔 ENTRADA CONFIRMADA — sinal ativo!');
    }
    prevAction.current = signalAction;
  }, [signalAction, soundEnabled, playBeep]);

  const enableSound = useCallback(() => {
    // Cria AudioContext com user gesture para garantir autoplay
    if (!audioCtx.current) audioCtx.current = new AudioContext();
    setSoundEnabled(prev => !prev);
  }, []);

  return { soundEnabled, enableSound };
}

const LivePro = () => {
  const { performance, registerSignal, resolve } = useHybridPerformance();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [bankroll, setBankroll] = useState(() => Number(localStorage.getItem('livepro_bankroll') || '1000'));
  const [exposure, setExposure] = useState(() => Number(localStorage.getItem('livepro_exposure') || '5'));

  useEffect(() => { localStorage.setItem('livepro_bankroll', String(bankroll)); }, [bankroll]);
  useEffect(() => { localStorage.setItem('livepro_exposure', String(exposure)); }, [exposure]);

  const { data: matches = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['live-matches'], queryFn: () => fetchLiveMatches(),
    refetchInterval: 60000, staleTime: 55000,
  });

  // Selecionar primeira partida automaticamente
  useEffect(() => {
    if (!selectedId && matches.length > 0) {
      const first = (matches as any[])[0];
      const id = String(first?.fixture?.id || first?.id);
      setSelectedId(id);
    }
  }, [matches, selectedId]);

  const selectedMatch = useMemo(() => {
    return (matches as any[]).find(m => String(m?.fixture?.id || m?.id) === selectedId) || (matches as any[])[0];
  }, [matches, selectedId]);

  const analysis = useMemo(() => {
    if (!selectedMatch) return null;
    const id = String(selectedMatch?.fixture?.id || selectedMatch?.id);
    const minute = selectedMatch?.fixture?.status?.elapsed || selectedMatch?.minute || 0;
    const homeGoals = selectedMatch?.goals?.home ?? selectedMatch?.liveScore?.home ?? 0;
    const awayGoals = selectedMatch?.goals?.away ?? selectedMatch?.liveScore?.away ?? 0;
    const homeName = selectedMatch?.teams?.home?.name || selectedMatch?.homeTeam || 'Casa';
    const awayName = selectedMatch?.teams?.away?.name || selectedMatch?.awayTeam || 'Fora';
    // TEST MODE: injeta scouts fictícios para validação do fluxo
    const homeStats = testMode
      ? { shotsOnGoal: 6, totalShots: 14, possession: 58, corners: 5, dangerousAttacks: 42 }
      : (selectedMatch?.stats?.home || null);
    const awayStats = testMode
      ? { shotsOnGoal: 3, totalShots: 8, possession: 42, corners: 3, dangerousAttacks: 28 }
      : (selectedMatch?.stats?.away || null);

    let pressure: PressureData | null = null;
    let history: PISnapshot[] = [];
    let strategies: LiveStrategy[] = [];
    let apWindows: AttackPressureWindows | null = null;
    let oddsDev: OddsDeviation | null = null;
    let hybrid: HybridSignal | null = null;
    let sniper: SniperSignal | null = null;
    let cornerData: CornerPeriod[] = [];

    try { pressure = analyzeLivePressure(homeStats, awayStats, minute); } catch {}
    try { if (pressure) history = recordPISnapshot(id, pressure.homePI, pressure.awayPI, minute); } catch {}
    try { strategies = generateLiveStrategy(homeStats, awayStats, minute, homeGoals, awayGoals, homeName, awayName); } catch {}
    try { apWindows = calculateAPWindows(history, minute); } catch {}
    try { oddsDev = calculateLiveOddsDeviation(homeStats, awayStats, homeGoals, awayGoals, minute); } catch {}
    try { hybrid = classifyHybridSignal(selectedMatch); } catch {}
    try { sniper = analyzeSniperSignal({ ...selectedMatch, isLive: true, id }); } catch {}
    try { cornerData = projectCornersByPeriod(homeStats?.corners || 0, awayStats?.corners || 0, minute); } catch {}

    const totalGoals = homeGoals + awayGoals;
    const poisson = calculatePoisson(homeStats, awayStats, minute, totalGoals);
    // Verifica integridade dos dados de pressão (DA + posse válidos)
    const totalDA_check = (homeStats?.dangerousAttacks || 0) + (awayStats?.dangerousAttacks || 0);
    const possessionValid = (homeStats?.possession || 0) > 0 || (awayStats?.possession || 0) > 0;
    const pressureDataValid = totalDA_check > 0 || possessionValid;
    const homePI = pressureDataValid ? (pressure?.homePI || 0) : 0;
    const awayPI = pressureDataValid ? (pressure?.awayPI || 0) : 0;
    const narrative = pressureDataValid
      ? buildPressureNarrative(homePI, awayPI, homeName, awayName)
      : 'Sem scouts disponíveis para esta partida';
    const rawDecision = buildSignalDecision(hybrid, sniper, strategies[0], minute, narrative);

    // Filtros inteligentes (gatilhos reativos) — sensibilidade melhorada
    const maxPI = Math.max(homePI, awayPI);
    const totalDA = totalDA_check;
    const daPerMin = totalDA / Math.max(minute, 1);
    const noGoalRecent = totalGoals === 0 && minute >= 20;

    // PI trend: verifica se PI subiu ≥10% nos últimos 5 snapshots
    let piTrending = false;
    if (history.length >= 2) {
      const recent = history.slice(-5);
      const oldest = Math.max(recent[0].homePI, recent[0].awayPI);
      const newest = Math.max(recent[recent.length - 1].homePI, recent[recent.length - 1].awayPI);
      if (oldest > 0 && ((newest - oldest) / oldest) >= 0.10) piTrending = true;
    }

    // Pressão Alta: PI ≥ 60 OU trending up ≥10% nos últimos 5min
    const pressaoAlta = pressureDataValid && (maxPI >= 60 || piTrending);
    // PI Alto: threshold mais acessível (≥ 40 ao invés de 50)
    const piAlto = pressureDataValid && maxPI >= 40;
    // Ataques: threshold mais acessível (≥ 1.0/min ao invés de 1.5)
    const ataquesAltos = pressureDataValid && daPerMin >= 1.0;

    const filters = [
      { label: 'Pressão alta', ok: pressaoAlta, detail: pressureDataValid ? `PI ${maxPI.toFixed(0)}${piTrending ? ' ↑' : ''}` : 'N/A' },
      { label: 'PI alto', ok: piAlto, detail: pressureDataValid ? `${maxPI.toFixed(1)}` : 'N/A' },
      { label: 'Ataques ≥1/min', ok: ataquesAltos, detail: pressureDataValid ? `${daPerMin.toFixed(1)}/min` : 'N/A' },
      { label: 'Sem gol recente', ok: noGoalRecent, detail: noGoalRecent ? `0 gols em ${minute}'` : `${totalGoals} gol(s)` },
      { label: 'Odd com valor', ok: rawDecision.action === 'ENTRAR', detail: rawDecision.action === 'ENTRAR' ? `${rawDecision.confidence}%` : '—' },
    ];
    const filtersValidated = filters.filter(f => f.ok).length;
    const filtersOk = filtersValidated >= 4 && rawDecision.action === 'ENTRAR';

    // Gate final: ENTRAR só se ≥ 4/5 filtros validados; senão AGUARDANDO neutro
    const decision: SignalDecision = filtersOk
      ? rawDecision
      : { ...rawDecision, action: 'AGUARDANDO', reason: rawDecision.action === 'ENTRAR'
          ? `Sinal detectado mas só ${filtersValidated}/5 filtros validados • ${narrative}`
          : rawDecision.reason };

    return {
      id, minute, homeGoals, awayGoals, homeName, awayName, homeStats, awayStats,
      pressure, history, strategies, apWindows, oddsDev, hybrid, sniper, poisson, decision, totalGoals, cornerData,
      filters, filtersValidated, filtersOk, pressureDataValid,
    };
  }, [selectedMatch, testMode]);

  // Auto-Mode: monitora sinal e dispara entrada interna quando filtros validados
  const autoExecutedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoMode || !analysis) return;
    const key = `${analysis.id}-${analysis.decision.market}-${analysis.minute}`;
    const prevKey = `${analysis.id}-${analysis.decision.market}`;

    console.log('[AUTO-MODE]', {
      match: `${analysis.homeName} vs ${analysis.awayName}`,
      minute: analysis.minute,
      action: analysis.decision.action,
      market: analysis.decision.market,
      confidence: analysis.decision.confidence,
      filtersValidated: `${analysis.filtersValidated}/5`,
      filtersOk: analysis.filtersOk,
    });

    if (!analysis.filtersOk) {
      console.log('[AUTO-MODE] ✗ Entrada recusada — filtros insuficientes ou sem sinal ENTRAR');
      return;
    }
    if ([...autoExecutedRef.current].some(k => k.startsWith(prevKey))) {
      console.log('[AUTO-MODE] ✗ Entrada já executada para este mercado neste jogo');
      return;
    }
    autoExecutedRef.current.add(key);
    const stakeValue = (bankroll * exposure) / 100;
    console.log('[AUTO-MODE] ✓ EXECUTANDO entrada automática', {
      market: analysis.decision.market, stake: `R$ ${stakeValue.toFixed(2)}`,
    });
    if (analysis.hybrid && analysis.hybrid.canExecute) {
      registerSignal(analysis.hybrid).then(row => {
        if (row) toast.success(`AUTO: ${analysis.decision.market}`, {
          description: `Stake R$ ${stakeValue.toFixed(2)} • ${analysis.minute}'`,
        });
      });
    } else {
      toast.success(`AUTO (simulado): ${analysis.decision.market}`, {
        description: `Stake R$ ${stakeValue.toFixed(2)} • ${analysis.minute}'`,
      });
    }
  }, [autoMode, analysis, bankroll, exposure, registerSignal]);

  const handleGenerateEntry = useCallback(async () => {
    if (!analysis) return;
    if (analysis.decision.action !== 'ENTRAR') {
      toast.warning('Nenhum sinal de entrada ativo no momento');
      return;
    }
    if (analysis.hybrid && analysis.hybrid.canExecute) {
      const row = await registerSignal(analysis.hybrid);
      if (row) toast.success(`Entrada registrada: ${analysis.hybrid.market}`, { description: `${analysis.homeName} vs ${analysis.awayName} • ${analysis.minute}'` });
      else toast.error('Não foi possível registrar a entrada');
    } else {
      toast.success(`Sugestão: ${analysis.decision.market}`, { description: `Confiança ${analysis.decision.confidence}% • Janela ${analysis.decision.windowText}` });
    }
  }, [analysis, registerSignal]);

  const matchOptions = useMemo(() => {
    return (matches as any[]).map(m => ({
      id: String(m?.fixture?.id || m?.id),
      label: `${m?.teams?.home?.name || m?.homeTeam || 'Casa'} vs ${m?.teams?.away?.name || m?.awayTeam || 'Fora'}`,
      minute: m?.fixture?.status?.elapsed || m?.minute || 0,
      home: m?.goals?.home ?? 0, away: m?.goals?.away ?? 0,
    }));
  }, [matches]);

  // Sound alert hook
  const { soundEnabled, enableSound } = useSignalSound(analysis?.decision?.action);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0D1117] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!analysis || !selectedMatch) {
    return (
      <div className="min-h-screen bg-[#0D1117] text-[#e6edf3] p-4">
        <div className="max-w-md mx-auto text-center mt-20">
          <Activity className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Nenhuma partida ao vivo no momento</p>
          <Link to="/live" className="text-orange-400 underline text-sm mt-2 inline-block">Voltar ao Live clássico</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#e6edf3]">
      <div className="container max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4">

        {/* ═══ TOP BAR ═══ */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Link to="/live" className="text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-bold text-base sm:text-lg tracking-tight text-white">LIVE TRADER PRO</h1>
            <span className="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-bold">BETA</span>
            <button
              onClick={() => setTestMode(t => !t)}
              className={`text-[9px] px-1.5 py-0.5 rounded font-bold border transition-colors ${testMode ? 'bg-purple-500/20 text-purple-400 border-purple-500/50' : 'bg-[#161B22] text-gray-500 border-[#30363D] hover:text-gray-300'}`}
              title="Modo teste: injeta scouts fictícios"
            >
              {testMode ? '🧪 TEST ON' : '🧪'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedId || ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="bg-[#161B22] border border-[#30363D] text-white text-xs rounded-lg px-2 py-1.5 max-w-[180px] sm:max-w-xs"
            >
              {matchOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label} ({opt.minute}')</option>
              ))}
            </select>
            <button onClick={() => refetch()} className="p-1.5 rounded-lg bg-[#161B22] border border-[#30363D] hover:bg-[#1c2333]">
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>
            <button
              onClick={enableSound}
              className={`p-1.5 rounded-lg border transition-colors ${soundEnabled ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-[#161B22] border-[#30363D] text-gray-400 hover:bg-[#1c2333]'}`}
              title={soundEnabled ? 'Som ativado' : 'Ativar som'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* ═══ HEADER PRINCIPAL: PLACAR ═══ */}
        <ScoreHeader analysis={analysis} match={selectedMatch} />

        {/* ═══ GRID PRINCIPAL: 1 col (mobile) → 3 cols (desktop) ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">

          {/* COLUNA ESQUERDA + CENTRO: KPIs, Probabilidade, Odds, Gráficos */}
          <div className="lg:col-span-2 space-y-3 sm:space-y-4 order-2 lg:order-1">

            {/* KPIs */}
            <KpiGrid analysis={analysis} />

            {/* Probabilidade */}
            <ProbabilityBlock analysis={analysis} />

            {/* Odds & Valor */}
            <OddsValueBlock analysis={analysis} />

            {/* Sugestão de Entrada (detalhada) */}
            <EntrySuggestion analysis={analysis} bankroll={bankroll} />

            {/* Filtros Inteligentes */}
            <SmartFilters analysis={analysis} />

            {/* Gráficos (colapsável no mobile) */}
            <ChartsBlock analysis={analysis} />

            {/* Histórico */}
            <PerformanceBlock performance={performance} resolve={resolve} />

            {/* Modo Automático */}
            <AutoModeBlock
              autoMode={autoMode} setAutoMode={setAutoMode}
              bankroll={bankroll} setBankroll={setBankroll}
              exposure={exposure} setExposure={setExposure}
              analysis={analysis}
            />
          </div>

          {/* COLUNA DIREITA: SINAL PRINCIPAL (sticky no desktop, topo no mobile) */}
          <div className="lg:col-span-1 order-1 lg:order-2">
            <div className="lg:sticky lg:top-4">
              <MainSignalCard analysis={analysis} onGenerate={handleGenerateEntry} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// SUB-COMPONENTES
// ═══════════════════════════════════════════════════════════

function ScoreHeader({ analysis, match }: { analysis: any; match: any }) {
  return (
    <div className="bg-gradient-to-br from-[#161B22] to-[#0D1117] border border-[#30363D] rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider truncate">{match?.league?.name || 'Liga'}</span>
        <div className="flex items-center gap-1.5 bg-red-500/10 px-2 py-0.5 rounded-full">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
          </span>
          <span className="text-[10px] font-bold text-red-400">LIVE {analysis.minute}'</span>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="text-right">
          <p className="font-bold text-sm sm:text-lg uppercase truncate">{analysis.homeName}</p>
        </div>
        <div className="bg-[#0D1117] rounded-lg px-3 sm:px-4 py-1.5 border border-orange-500/30">
          <span className="font-bold text-2xl sm:text-3xl text-orange-400 tabular-nums">
            {analysis.homeGoals} <span className="text-gray-500">:</span> {analysis.awayGoals}
          </span>
        </div>
        <div className="text-left">
          <p className="font-bold text-sm sm:text-lg uppercase truncate">{analysis.awayName}</p>
        </div>
      </div>
      {/* Barra de tempo */}
      <div className="mt-3">
        <div className="h-1 bg-[#30363D] rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-red-500 transition-all"
            style={{ width: `${Math.min(100, (analysis.minute / 90) * 100)}%` }} />
        </div>
        <div className="flex justify-between text-[9px] text-gray-500 mt-1">
          <span>0'</span><span>45'</span><span>90'</span>
        </div>
      </div>
    </div>
  );
}

function MainSignalCard({ analysis, onGenerate }: { analysis: any; onGenerate: () => void }) {
  const { decision, filtersValidated } = analysis;
  const actionStyles = {
    ENTRAR: { bg: 'bg-emerald-500/15', border: 'border-emerald-500', text: 'text-emerald-400', btn: 'bg-emerald-500 hover:bg-emerald-600 text-white', icon: '🟢', label: 'ENTRAR' },
    AGUARDANDO: { bg: 'bg-[#161B22]', border: 'border-[#30363D]', text: 'text-gray-400', btn: 'bg-[#21262d] hover:bg-[#2d333b] text-gray-300 border border-[#30363D]', icon: '⏳', label: 'AGUARDANDO' },
    AGUARDAR: { bg: 'bg-[#161B22]', border: 'border-[#30363D]', text: 'text-gray-400', btn: 'bg-[#21262d] hover:bg-[#2d333b] text-gray-300 border border-[#30363D]', icon: '⏳', label: 'AGUARDANDO' },
    BLOQUEADO: { bg: 'bg-red-500/10', border: 'border-red-500/50', text: 'text-red-400', btn: 'bg-gray-700 cursor-not-allowed text-gray-400', icon: '🔴', label: 'BLOQUEADO' },
  }[decision.action as 'ENTRAR' | 'AGUARDANDO' | 'AGUARDAR' | 'BLOQUEADO'];
  const strengthMap = { forte: '🔥🔥🔥', médio: '🔥🔥', fraco: '🔥' };
  const isWaiting = decision.action !== 'ENTRAR';

  return (
    <div className={`${actionStyles.bg} border-2 ${actionStyles.border} rounded-xl p-4 shadow-lg`}>
      <div className="flex items-center gap-2 mb-3">
        <Target className={`w-5 h-5 ${actionStyles.text}`} />
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Sinal Principal</span>
      </div>
      <div className="text-center mb-3">
        <div className={`text-3xl sm:text-4xl font-black ${actionStyles.text} tracking-tight`}>
          {actionStyles.icon} {actionStyles.label}
        </div>
        <div className={`mt-1 text-[10px] font-bold ${filtersValidated >= 4 ? 'text-emerald-400' : 'text-gray-500'}`}>
          FILTROS {filtersValidated}/5 {filtersValidated >= 4 ? '✓' : ''}
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <div className="bg-[#0D1117]/50 rounded-lg px-3 py-2 border border-[#30363D]">
          <p className="text-[10px] text-gray-500 uppercase">Mercado</p>
          <p className={`font-bold text-sm ${isWaiting ? 'text-gray-400' : 'text-white'}`}>{decision.market}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[#0D1117]/50 rounded-lg px-2 py-1.5 border border-[#30363D]">
            <p className="text-[9px] text-gray-500 uppercase">Confiança</p>
            <p className={`font-bold text-base ${isWaiting ? 'text-gray-400' : actionStyles.text}`}>{decision.confidence}%</p>
          </div>
          <div className="bg-[#0D1117]/50 rounded-lg px-2 py-1.5 border border-[#30363D]">
            <p className="text-[9px] text-gray-500 uppercase">Força</p>
            <p className={`font-bold text-base ${isWaiting ? 'text-gray-500' : 'text-white'}`}>{strengthMap[decision.strength]}</p>
          </div>
        </div>
        <div className="bg-[#0D1117]/50 rounded-lg px-3 py-2 border border-[#30363D]">
          <p className="text-[10px] text-gray-500 uppercase">Janela ideal</p>
          <p className={`font-bold text-sm ${isWaiting ? 'text-gray-400' : 'text-white'}`}>{decision.windowText}</p>
        </div>
        <p className="text-[10px] text-gray-400 italic px-1">{decision.reason}</p>
      </div>
      <Button
        onClick={onGenerate}
        disabled={isWaiting || decision.action === 'BLOQUEADO'}
        className={`w-full font-bold text-sm h-11 ${actionStyles.btn}`}
      >
        <Zap className="w-4 h-4 mr-2" /> {isWaiting ? 'AGUARDANDO SINAL' : 'GERAR ENTRADA'}
      </Button>
    </div>
  );
}

function KpiGrid({ analysis }: { analysis: any }) {
  const { pressure, homeStats, awayStats, pressureDataValid } = analysis;
  const homePI = pressure?.homePI || 0;
  const awayPI = pressure?.awayPI || 0;
  const totalPI = homePI + awayPI || 1;
  const homeShare = pressureDataValid ? Math.round((homePI / totalPI) * 100) : 50;
  const homeDA = homeStats?.dangerousAttacks || 0;
  const awayDA = awayStats?.dangerousAttacks || 0;
  const daDiff = Math.abs(homeDA - awayDA);
  const homePoss = homeStats?.possession ?? 0;
  const awayPoss = awayStats?.possession ?? 0;
  const possessionValid = homePoss > 0 || awayPoss > 0;
  const maxPI = Math.max(homePI, awayPI);

  const piColor = !pressureDataValid ? 'text-gray-500' : maxPI >= 60 ? 'text-red-400' : maxPI >= 40 ? 'text-yellow-400' : 'text-emerald-400';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      <KpiCard icon={Flame} label="Pressão" valueText={pressureDataValid ? `${homeShare}% / ${100 - homeShare}%` : 'N/A'} accent={pressureDataValid ? 'text-orange-400' : 'text-gray-500'}>
        {pressureDataValid ? (
          <div className="h-1 bg-[#30363D] rounded-full overflow-hidden mt-1">
            <div className="h-full bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${homeShare}%` }} />
          </div>
        ) : <p className="text-[9px] text-gray-600 mt-1">Sem scouts</p>}
      </KpiCard>
      <KpiCard icon={Zap} label="Ataques Perigosos" valueText={pressureDataValid ? `${homeDA} vs ${awayDA}` : 'N/A'} accent={pressureDataValid ? 'text-yellow-400' : 'text-gray-500'}>
        <p className="text-[9px] text-gray-500 mt-1">{pressureDataValid ? `Δ ${daDiff}` : 'Sem dados'}</p>
      </KpiCard>
      <KpiCard icon={Activity} label="Posse" valueText={possessionValid ? `${homePoss}% / ${awayPoss}%` : 'N/A'} accent={possessionValid ? 'text-cyan-400' : 'text-gray-500'}>
        {possessionValid ? (
          <div className="h-1 bg-[#30363D] rounded-full overflow-hidden mt-1">
            <div className="h-full bg-cyan-500" style={{ width: `${homePoss}%` }} />
          </div>
        ) : <p className="text-[9px] text-gray-600 mt-1">Sem scouts</p>}
      </KpiCard>
      <KpiCard icon={TrendingUp} label="Índice PI" valueText={pressureDataValid ? `${homePI.toFixed(1)} / ${awayPI.toFixed(1)}` : 'N/A'} accent={piColor}>
        <p className="text-[9px] text-gray-500 mt-1">{pressureDataValid ? `Máx ${maxPI.toFixed(1)}` : 'Aguardando API'}</p>
      </KpiCard>
    </div>
  );
}

function KpiCard({ icon: Icon, label, valueText, accent, children }: any) {
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-2.5 sm:p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${accent}`} />
        <span className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-sm sm:text-base font-bold tabular-nums ${accent}`}>{valueText}</p>
      {children}
    </div>
  );
}

function ProbabilityBlock({ analysis }: { analysis: any }) {
  const { poisson, totalGoals } = analysis;
  const items = [
    { label: 'Over 0.5', value: poisson.over05, threshold: 0.5 },
    { label: 'Over 1.5', value: poisson.over15, threshold: 1.5 },
    { label: 'Over 2.5', value: poisson.over25, threshold: 2.5 },
    { label: 'Over 3.5', value: poisson.over35, threshold: 3.5 },
  ];
  // Próximo mercado relevante (primeiro não concluído)
  const nextMarketIdx = items.findIndex(it => !poisson.completed.has(it.label));

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <h3 className="font-bold text-sm text-white">PROBABILIDADE (Poisson)</h3>
        </div>
        <span className="text-[10px] text-gray-400">xG proj: <span className="text-cyan-400 font-bold">{poisson.expectedGoals.toFixed(1)}</span></span>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => {
          const isCompleted = poisson.completed.has(it.label);
          const isNext = idx === nextMarketIdx;

          if (isCompleted) {
            return (
              <div key={it.label} className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] text-gray-500 w-14">{it.label}</span>
                <div className="flex-1 h-2.5 bg-[#0D1117] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-700 w-full" />
                </div>
                <span className="text-[10px] font-bold text-emerald-600 w-16 text-right">✓ Concluído</span>
              </div>
            );
          }

          const color = it.value >= 70 ? 'bg-emerald-500' : it.value >= 50 ? 'bg-yellow-500' : 'bg-red-500';
          const text = it.value >= 70 ? 'text-emerald-400' : it.value >= 50 ? 'text-yellow-400' : 'text-red-400';
          return (
            <div key={it.label} className={`flex items-center gap-2 ${isNext ? 'ring-1 ring-cyan-500/30 rounded-lg px-1 -mx-1 py-0.5' : ''}`}>
              <span className={`text-[10px] w-14 ${isNext ? 'text-cyan-400 font-bold' : 'text-gray-400'}`}>
                {isNext ? '▶ ' : ''}{it.label}
              </span>
              <div className="flex-1 h-2.5 bg-[#0D1117] rounded-full overflow-hidden">
                <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${it.value}%` }} />
              </div>
              <span className={`text-xs font-bold tabular-nums w-10 text-right ${text}`}>{it.value}%</span>
            </div>
          );
        })}
      </div>
      {nextMarketIdx >= 0 && (
        <p className="text-[9px] text-gray-500 mt-2 text-center">
          Foco: <span className="text-cyan-400 font-medium">{items[nextMarketIdx].label}</span> — prob. de +gol no tempo restante
        </p>
      )}
    </div>
  );
}

function OddsValueBlock({ analysis }: { analysis: any }) {
  const { oddsDev, poisson } = analysis;
  if (!oddsDev) return null;

  // Estimativa de odds justas: odd = 1 / probabilidade
  const fairOdd = (p: number) => {
    if (p <= 0) return 50;
    const o = 100 / p; // p está em percentual (0-100)
    return Math.min(50, +o.toFixed(2));
  };
  // Odd "atual" simulada com 8% de margem da casa
  const marketOdd = (p: number) => {
    const o = fairOdd(p) / 1.08;
    return Math.max(1.01, +o.toFixed(2));
  };
  const ev = (p: number, odd: number) => +(((p / 100) * odd - 1) * 100).toFixed(1);

  const allRows = [
    { market: 'Over 1.5', prob: poisson.over15 },
    { market: 'Over 2.5', prob: poisson.over25 },
    { market: 'Casa', prob: oddsDev.homeWinPoisson },
    { market: 'Empate', prob: oddsDev.drawPoisson },
    { market: 'Fora', prob: oddsDev.awayWinPoisson },
  ];
  // Filtra mercados com probabilidade relevante (≥ 5%) — evita exibir odds de 50+
  const rows = allRows.filter(r => r.prob >= 5);

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-4 h-4 text-emerald-400" />
        <h3 className="font-bold text-sm text-white">ODDS & VALOR</h3>
      </div>
      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] text-gray-500 uppercase border-b border-[#30363D]">
              <th className="text-left px-3 py-1.5">Mercado</th>
              <th className="text-right px-2 py-1.5">Prob</th>
              <th className="text-right px-2 py-1.5">Odd Mín</th>
              <th className="text-right px-2 py-1.5">Justa</th>
              <th className="text-right px-3 py-1.5">EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center text-gray-500 italic py-3 text-[11px]">Sem mercado com probabilidade relevante</td></tr>
            )}
            {rows.map(r => {
              const odd = marketOdd(r.prob);
              const fair = fairOdd(r.prob);
              const evVal = ev(r.prob, odd);
              const evColor = evVal >= 5 ? 'text-emerald-400' : evVal >= 0 ? 'text-yellow-400' : 'text-red-400';
              return (
                <tr key={r.market} className="border-b border-[#30363D]/50 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-white">{r.market}</td>
                  <td className="text-right px-2 py-1.5 tabular-nums text-cyan-300">{r.prob}%</td>
                  <td className="text-right px-2 py-1.5 tabular-nums text-gray-300">{odd.toFixed(2)}</td>
                  <td className="text-right px-2 py-1.5 tabular-nums text-gray-400">{fair.toFixed(2)}</td>
                  <td className={`text-right px-3 py-1.5 tabular-nums font-bold ${evColor}`}>{evVal > 0 ? '+' : ''}{evVal}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntrySuggestion({ analysis, bankroll }: { analysis: any; bankroll: number }) {
  const { decision, poisson } = analysis;
  const stakePct = decision.action === 'ENTRAR' ? (decision.strength === 'forte' ? 3 : decision.strength === 'médio' ? 2 : 1) : 0;
  const stakeValue = (bankroll * stakePct) / 100;
  const minOdd = decision.market.toLowerCase().includes('over 0.5') ? 1.20 : decision.market.toLowerCase().includes('over 1.5') ? 1.40 : 1.60;
  const stars = Math.round(decision.confidence / 20);
  const evEstimated = decision.action === 'ENTRAR' ? +(((decision.confidence / 100) * minOdd - 1) * 100).toFixed(1) : 0;

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-orange-400" />
        <h3 className="font-bold text-sm text-white">SUGESTÃO DE ENTRADA</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SuggestField label="Mercado" value={decision.market} />
        <SuggestField label="Odd mínima" value={minOdd.toFixed(2)} accent="text-emerald-400" />
        <SuggestField label="Stake" value={`${stakePct}% (R$ ${stakeValue.toFixed(2)})`} accent="text-yellow-400" />
        <SuggestField label="Confiança" value={'★'.repeat(stars) + '☆'.repeat(5 - stars)} accent="text-orange-400" />
      </div>
      <div className="mt-2 text-center">
        <span className="text-[10px] text-gray-500">EV estimado: </span>
        <span className={`text-xs font-bold ${evEstimated >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {evEstimated > 0 ? '+' : ''}{evEstimated}%
        </span>
      </div>
    </div>
  );
}

function SuggestField({ label, value, accent = 'text-white' }: any) {
  return (
    <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-2">
      <p className="text-[9px] text-gray-500 uppercase">{label}</p>
      <p className={`text-xs font-bold ${accent} truncate`}>{value}</p>
    </div>
  );
}

function SmartFilters({ analysis }: { analysis: any }) {
  const filters = analysis.filters as { label: string; ok: boolean; detail: string }[];
  const validated = analysis.filtersValidated as number;
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <h3 className="font-bold text-sm text-white">FILTROS INTELIGENTES</h3>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${validated >= 4 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
          {validated}/5 OK
        </span>
      </div>
      <div className="space-y-1.5">
        {filters.map(f => (
          <div key={f.label} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg ${f.ok ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-[#0D1117] border border-[#30363D]'}`}>
            {f.ok
              ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              : <XCircle className="w-4 h-4 text-gray-600 shrink-0" />
            }
            <span className={`text-xs flex-1 ${f.ok ? 'text-gray-200 font-medium' : 'text-gray-500'}`}>{f.label}</span>
            <span className={`text-[10px] tabular-nums ${f.ok ? 'text-emerald-400' : 'text-gray-600'}`}>{f.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartsBlock({ analysis }: { analysis: any }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl">
        <CollapsibleTrigger className="w-full p-3 sm:p-4 flex items-center justify-between hover:bg-[#1c2333] transition-colors rounded-xl">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm text-white">GRÁFICOS</h3>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-3">
            <MomentumChart history={analysis.history} homeName={analysis.homeName} awayName={analysis.awayName} currentMinute={analysis.minute} />
            <CornerTimeline data={analysis.cornerData} currentMinute={analysis.minute} />
            <OverGoalsPanel
              homeStats={analysis.homeStats} awayStats={analysis.awayStats}
              homeGoals={analysis.homeGoals} awayGoals={analysis.awayGoals} minute={analysis.minute}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function PerformanceBlock({ performance, resolve }: { performance: any; resolve: (id: string, result: 'WIN' | 'LOSS' | 'CASHOUT', exitMinute?: number) => Promise<void> }) {
  const [resolving, setResolving] = useState<string | null>(null);
  if (!performance) return null;

  const handleResolve = async (id: string, result: 'WIN' | 'LOSS' | 'CASHOUT') => {
    setResolving(id);
    try {
      await resolve(id, result);
      toast.success(result === 'WIN' ? '✅ Ganhou!' : result === 'LOSS' ? '❌ Perdeu' : '↩ Reembolsado');
    } catch {
      toast.error('Erro ao atualizar');
    }
    setResolving(null);
  };

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-emerald-400" />
        <h3 className="font-bold text-sm text-white">HISTÓRICO</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="ROI" value={`${performance.roi >= 0 ? '+' : ''}${performance.roi}%`} accent={performance.roi >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <Stat label="Assertividade" value={`${performance.winrate}%`} accent="text-cyan-400" />
        <Stat label="Greens" value={`${performance.wins}`} accent="text-emerald-400" />
        <Stat label="Reds" value={`${performance.losses}`} accent="text-red-400" />
      </div>
      <div className="mt-3 flex gap-1 flex-wrap">
        {performance.last10.map((r: string, i: number) => (
          <span key={i} className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${
            r === 'W' ? 'bg-emerald-500/20 text-emerald-400' : r === 'L' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
          }`}>{r}</span>
        ))}
        {performance.last10.length === 0 && <span className="text-[10px] text-gray-500 italic">Sem entradas resolvidas</span>}
      </div>

      {/* Entradas pendentes com botões de resolução */}
      {performance.entries && performance.entries.filter((e: any) => e.result === 'PENDING').length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[9px] text-gray-500 uppercase tracking-wider">Pendentes — resolver:</p>
          {performance.entries.filter((e: any) => e.result === 'PENDING').map((entry: any) => (
            <div key={entry.id} className="flex items-center gap-2 bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-gray-200 truncate">{entry.match_name}</p>
                <p className="text-[9px] text-gray-500">{entry.market} • {entry.minute}'</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleResolve(entry.id, 'WIN')}
                  disabled={resolving === entry.id}
                  className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 active:scale-95 transition-all flex items-center justify-center"
                  title="Ganhou"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleResolve(entry.id, 'LOSS')}
                  disabled={resolving === entry.id}
                  className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 active:scale-95 transition-all flex items-center justify-center"
                  title="Perdeu"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleResolve(entry.id, 'CASHOUT')}
                  disabled={resolving === entry.id}
                  className="w-8 h-8 rounded-lg bg-gray-500/20 border border-gray-500/40 text-gray-400 hover:bg-gray-500/30 active:scale-95 transition-all flex items-center justify-center"
                  title="Reembolsado"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, value, accent }: any) => (
  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-2 text-center">
    <p className="text-[9px] text-gray-500 uppercase">{label}</p>
    <p className={`text-base font-bold tabular-nums ${accent}`}>{value}</p>
  </div>
);

function AutoModeBlock({ autoMode, setAutoMode, bankroll, setBankroll, exposure, setExposure, analysis }: any) {
  const exposureValue = (bankroll * exposure) / 100;
  const validated = analysis?.filtersValidated ?? 0;
  const ready = analysis?.filtersOk;

  // Log mudanças de toggle
  useEffect(() => {
    console.log(`[AUTO-MODE] toggle ${autoMode ? 'ATIVADO ✓' : 'DESATIVADO ✗'}`, {
      bankroll, exposure, exposicaoMax: exposureValue,
    });
  }, [autoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className={`w-4 h-4 ${autoMode ? 'text-emerald-400 animate-pulse' : 'text-gray-500'}`} />
          <h3 className="font-bold text-sm text-white">MODO AUTOMÁTICO</h3>
        </div>
        <Switch checked={autoMode} onCheckedChange={setAutoMode} />
      </div>
      {autoMode && (
        <div className={`text-[10px] mb-3 px-2 py-1.5 rounded border ${ready ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'}`}>
          {ready
            ? `✓ Pronto para executar — ${validated}/5 filtros OK • sinal ENTRAR`
            : `⏸ Monitorando — ${validated}/5 filtros validados (precisa ≥4 + ENTRAR)`}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-gray-500 uppercase">Banca (R$)</label>
          <input
            type="number" min={0} value={bankroll} onChange={e => setBankroll(Number(e.target.value))}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-white mt-1"
          />
        </div>
        <div>
          <label className="text-[9px] text-gray-500 uppercase">Exposição máx (%)</label>
          <input
            type="number" min={0} max={100} value={exposure} onChange={e => setExposure(Number(e.target.value))}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-white mt-1"
          />
        </div>
      </div>
      <div className="mt-2 text-center text-[10px] text-gray-400">
        Exposição máx: <span className="text-orange-400 font-bold tabular-nums">R$ {exposureValue.toFixed(2)}</span>
      </div>
    </div>
  );
}

export default LivePro;
