import { useMemo, useState } from 'react';
import { MatchData } from '@/types/match';
import { Badge } from '@/components/ui/badge';
import {
  analyzeSniperSignal,
  registerSniperEntry,
  resolveSniperOperation,
  getSniperPerformance,
  getPendingOperations,
  getAllOperations,
  SniperSignal,
  SniperOperation,
} from '@/lib/sniperEngine';
import {
  Crosshair, Flame, Target, ShieldCheck, ShieldAlert,
  TrendingUp, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, XCircle, Clock
} from 'lucide-react';

interface SniperPanelProps {
  matches: MatchData[];
  modoSniper?: boolean;
  modoLucroReal?: boolean;
}

function ResultBadge({ result }: { result: string }) {
  if (result === 'WIN') return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">✅ WIN</Badge>;
  if (result === 'LOSS') return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">❌ LOSS</Badge>;
  if (result === 'CASHOUT') return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">💰 CASH</Badge>;
  return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">⏳ PENDING</Badge>;
}

export default function SniperPanel({ matches, modoSniper = true, modoLucroReal = true }: SniperPanelProps) {
  const [showLogs, setShowLogs] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [, setForceUpdate] = useState(0);

  const signals = useMemo(() => {
    if (!modoSniper) return [];
    const liveMatches = matches.filter(m => m.isLive);
    const results: SniperSignal[] = [];
    for (const match of liveMatches) {
      const signal = analyzeSniperSignal(match);
      if (signal) results.push(signal);
    }
    return results.sort((a, b) => {
      if (a.isSniper && !b.isSniper) return -1;
      if (!a.isSniper && b.isSniper) return 1;
      return b.pressure - a.pressure;
    });
  }, [matches, modoSniper]);

  const sniperSignals = signals.filter(s => s.isSniper);
  const normalSignals = signals.filter(s => !s.isSniper);
  const performance = getSniperPerformance();
  const pendingOps = getPendingOperations();
  const allOps = getAllOperations();

  const handleEntry = (signal: SniperSignal) => {
    const op = registerSniperEntry(signal);
    if (op) {
      setForceUpdate(n => n + 1);
    }
  };

  const handleResolve = (opId: string, result: 'WIN' | 'LOSS' | 'CASHOUT') => {
    resolveSniperOperation(opId, result);
    setForceUpdate(n => n + 1);
  };

  if (!modoSniper) return null;

  return (
    <div className="rounded-2xl border border-red-500/20 bg-black/40 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-red-500/15 to-orange-500/10 border-b border-red-500/20">
        <Target className="w-5 h-5 text-red-500" />
        <h2 className="text-sm font-black uppercase tracking-wider text-red-400">
          Modo SNIPER 🔥
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {performance.isBlocked && (
            <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px]">
              🚫 BLOQUEADO
            </Badge>
          )}
          <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px]">
            {sniperSignals.length} SNIPER
          </Badge>
        </div>
      </div>

      {/* Performance Dashboard */}
      <div className="px-4 py-3 bg-black/20 border-b border-white/5">
        <div className="grid grid-cols-5 gap-2 text-center">
          <div>
            <p className="text-[9px] text-gray-500">Win Rate</p>
            <p className={`text-sm font-black ${performance.winrate >= 60 ? 'text-emerald-400' : performance.winrate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {performance.winrate}%
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-500">Entradas</p>
            <p className="text-sm font-black text-white">{performance.totalEntries}</p>
          </div>
          <div>
            <p className="text-[9px] text-gray-500">W/L</p>
            <p className="text-sm font-black">
              <span className="text-emerald-400">{performance.wins}</span>
              <span className="text-gray-600">/</span>
              <span className="text-red-400">{performance.losses}</span>
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-500">ROI</p>
            <p className={`text-sm font-black ${performance.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {performance.roi > 0 ? '+' : ''}{performance.roi}%
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-500">Status</p>
            <p className={`text-sm font-black ${
              performance.dayStatus === 'positivo' ? 'text-emerald-400' :
              performance.dayStatus === 'negativo' ? 'text-red-400' : 'text-gray-400'
            }`}>
              {performance.dayStatus === 'positivo' ? '📈' : performance.dayStatus === 'negativo' ? '📉' : '➖'}
            </p>
          </div>
        </div>

        {/* Last 10 results */}
        {performance.last10.length > 0 && (
          <div className="flex items-center gap-1 mt-2 justify-center">
            <span className="text-[9px] text-gray-500 mr-1">Últimos:</span>
            {performance.last10.map((r, i) => (
              <span
                key={i}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  r === 'W' ? 'bg-emerald-500/20 text-emerald-400' :
                  r === 'L' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}
              >
                {r}
              </span>
            ))}
          </div>
        )}

        {performance.isBlocked && (
          <div className="mt-2 px-3 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20">
            <p className="text-[10px] text-red-400 font-bold flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              {performance.blockReason}
            </p>
          </div>
        )}
      </div>

      {/* Pending Operations */}
      {pendingOps.length > 0 && (
        <div className="border-b border-white/5">
          <div className="px-4 py-2 bg-blue-500/5">
            <p className="text-[10px] font-bold text-blue-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              OPERAÇÕES ATIVAS ({pendingOps.length})
            </p>
          </div>
          {pendingOps.map(op => (
            <div key={op.id} className="px-4 py-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white">{op.match}</span>
                  <span className="text-[10px] text-gray-500 ml-2">{op.market} • {op.minute}'</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleResolve(op.id, 'WIN')}
                    className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[9px] font-bold hover:bg-emerald-500/30"
                  >
                    GOL ✅
                  </button>
                  <button
                    onClick={() => handleResolve(op.id, 'CASHOUT')}
                    className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[9px] font-bold hover:bg-yellow-500/30"
                  >
                    CASH 💰
                  </button>
                  <button
                    onClick={() => handleResolve(op.id, 'LOSS')}
                    className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-[9px] font-bold hover:bg-red-500/30"
                  >
                    LOSS ❌
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sniper Signals */}
      {sniperSignals.length > 0 ? (
        <div className="divide-y divide-white/5">
          {sniperSignals.map((signal, i) => (
            <div key={signal.matchId} className="px-4 py-3 hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-red-500 animate-pulse" />
                  <span className="text-sm font-bold text-white">{signal.match}</span>
                </div>
                <span className="text-[10px] font-bold text-red-400 animate-pulse">{signal.signal}</span>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-gray-500">{signal.league}</span>
                <span className="text-[10px] text-green-400 font-mono">{signal.minute}'</span>
                <Badge className="bg-red-500/15 text-red-300 border-red-500/25 text-[10px]">{signal.market}</Badge>
              </div>

              <div className="flex items-center gap-3 mt-2 flex-wrap text-[10px]">
                <span className="text-yellow-400">DA/5min: {signal.da5min}</span>
                <span className="text-orange-400">APPM: {signal.appm}</span>
                <span className="text-emerald-400">SoG: {signal.shotsOnGoal}</span>
                <span className="text-blue-400">Corners: {signal.corners}</span>
                <span className={`font-bold ${signal.pressure >= 70 ? 'text-red-400' : 'text-yellow-400'}`}>
                  Pressure: {signal.pressure}
                </span>
              </div>

              {/* Execution */}
              {modoLucroReal && (
                <div className="mt-2">
                  {signal.canExecute ? (
                    <button
                      onClick={() => handleEntry(signal)}
                      className="w-full px-3 py-1.5 bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30 rounded-lg text-[11px] font-bold text-red-400 hover:from-red-500/30 hover:to-orange-500/30 transition-all flex items-center justify-center gap-1"
                    >
                      <Crosshair className="w-3 h-3" />
                      ENTRAR — Over 0.5 HT (1% banca)
                    </button>
                  ) : (
                    <p className="text-[9px] text-gray-500 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {signal.executionReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-6 text-center">
          <Target className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">Nenhum sinal SNIPER ativo</p>
          <p className="text-[10px] text-gray-600 mt-1">
            Aguardando jogos ao vivo 0x0 entre 5-30 min com alta pressão
          </p>
        </div>
      )}

      {/* Normal opportunities (collapsed) */}
      {normalSignals.length > 0 && (
        <div className="border-t border-white/5">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full px-4 py-2 flex items-center justify-between text-[10px] text-gray-500 hover:bg-white/5"
          >
            <span>{normalSignals.length} oportunidades normais</span>
            {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showLogs && (
            <div className="divide-y divide-white/5">
              {normalSignals.slice(0, 5).map(signal => (
                <div key={signal.matchId} className="px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">{signal.match}</span>
                    <span className="text-[10px] text-gray-500">{signal.minute}'</span>
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[9px] text-gray-600">
                    <span>DA/5m: {signal.da5min}</span>
                    <span>APPM: {signal.appm}</span>
                    <span>SoG: {signal.shotsOnGoal}</span>
                    <span>P: {signal.pressure}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Operation History */}
      <div className="border-t border-white/5">
        <button
          onClick={() => setShowOperations(!showOperations)}
          className="w-full px-4 py-2 flex items-center justify-between text-[10px] text-gray-500 hover:bg-white/5"
        >
          <span>📋 Histórico de Operações ({allOps.length})</span>
          {showOperations ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showOperations && allOps.length > 0 && (
          <div className="max-h-40 overflow-y-auto divide-y divide-white/5">
            {allOps.slice(-10).reverse().map(op => (
              <div key={op.id} className="px-4 py-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">{op.match}</span>
                  <span className="text-[9px] text-gray-600">{op.minute}'</span>
                </div>
                <ResultBadge result={op.result} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-black/30 border-t border-white/5">
        <div className="flex items-center justify-between text-[9px] text-gray-600">
          <span>Stake: 1% | Max 3/dia | STOP: 2 losses | Sem martingale</span>
          <span>Thresholds: P≥{performance.adjustedThresholds.pressureMin} C≥{performance.adjustedThresholds.cornersMin}</span>
        </div>
      </div>
    </div>
  );
}
