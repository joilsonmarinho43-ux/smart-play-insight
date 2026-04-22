import { useMemo, useState, useEffect, useRef } from 'react';
import { MatchData } from '@/types/match';
import { Badge } from '@/components/ui/badge';
import {
  classifyHybridSignal,
  shouldNotify,
  markNotified,
  buildNotificationText,
  type HybridSignal,
  type HybridTier,
} from '@/lib/hybridEngine';
import { useHybridPerformance } from '@/hooks/useHybridPerformance';
import {
  Crosshair, Flame, Target, ShieldAlert, Zap, Search,
  ChevronDown, ChevronUp, AlertTriangle, Clock
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface SniperPanelProps {
  matches: MatchData[];
  modoSniper?: boolean;
  modoLucroReal?: boolean;
}

const TIER_STYLES: Record<HybridTier, { bg: string; border: string; text: string; icon: typeof Flame; badgeBg: string }> = {
  SNIPER: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', icon: Flame, badgeBg: 'bg-red-500/20' },
  SEMI: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', icon: Zap, badgeBg: 'bg-yellow-500/20' },
  NORMAL: { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400', icon: Search, badgeBg: 'bg-gray-500/20' },
};

function ResultBadge({ result }: { result: string }) {
  if (result === 'WIN') return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">✅ WIN</Badge>;
  if (result === 'LOSS') return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">❌ LOSS</Badge>;
  if (result === 'CASHOUT') return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">💰 CASH</Badge>;
  return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">⏳ PENDING</Badge>;
}

function SignalCard({ signal, modoLucroReal, onEntry }: { signal: HybridSignal; modoLucroReal: boolean; onEntry: (s: HybridSignal) => void }) {
  const style = TIER_STYLES[signal.tier];
  const Icon = style.icon;

  return (
    <div className={`px-4 py-3 hover:bg-white/5 transition-colors ${style.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${style.text} ${signal.tier === 'SNIPER' ? 'animate-pulse' : ''}`} />
          <span className="text-sm font-bold text-white">{signal.match}</span>
        </div>
        <Badge className={`${style.badgeBg} ${style.text} ${style.border} text-[10px]`}>
          {signal.label}
        </Badge>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] text-gray-500">{signal.league}</span>
        <span className="text-[10px] text-green-400 font-mono">{signal.minute}'</span>
        <span className="text-[10px] text-gray-600">
          {signal.homeGoals}-{signal.awayGoals}
        </span>
        <Badge className={`${style.badgeBg} ${style.text} ${style.border} text-[10px]`}>{signal.market}</Badge>
        <Badge className="bg-white/5 text-gray-400 border-white/10 text-[10px]">
          Conf: {signal.confidence}
        </Badge>
      </div>

      <div className="flex items-center gap-3 mt-2 flex-wrap text-[10px]">
        <span className="text-orange-400">DA: {signal.dangerousAttacks}</span>
        <span className="text-emerald-400">SoG: {signal.shotsOnGoal}</span>
        <span className="text-blue-400">Cantos: {signal.corners}</span>
        <span className="text-purple-400">Posse: {signal.possession}%</span>
        <span className={`font-bold ${signal.pressure >= 70 ? 'text-red-400' : signal.pressure >= 60 ? 'text-yellow-400' : 'text-gray-400'}`}>
          Pressure: {signal.pressure}
        </span>
      </div>

      {/* Execution */}
      {modoLucroReal && signal.tier !== 'NORMAL' && (
        <div className="mt-2">
          {signal.canExecute ? (
            <button
              onClick={() => onEntry(signal)}
              className={`w-full px-3 py-1.5 ${style.bg} border ${style.border} rounded-lg text-[11px] font-bold ${style.text} hover:brightness-125 transition-all flex items-center justify-center gap-1`}
            >
              <Crosshair className="w-3 h-3" />
              ENTRAR — {signal.market} (1% banca)
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
  );
}

export default function SniperPanel({ matches, modoSniper = true, modoLucroReal = true }: SniperPanelProps) {
  const [showNormal, setShowNormal] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [, setForceUpdate] = useState(0);
  const notifiedRef = useRef<Set<string>>(new Set());

  const signals = useMemo(() => {
    if (!modoSniper) return [];
    const liveMatches = matches.filter(m => m.isLive);
    const results: HybridSignal[] = [];
    for (const match of liveMatches) {
      const signal = classifyHybridSignal(match);
      if (signal) results.push(signal);
    }
    // Sort: SNIPER > SEMI > NORMAL, then by pressure
    const tierOrder: Record<HybridTier, number> = { SNIPER: 0, SEMI: 1, NORMAL: 2 };
    return results.sort((a, b) => {
      const td = tierOrder[a.tier] - tierOrder[b.tier];
      if (td !== 0) return td;
      return b.pressure - a.pressure;
    });
  }, [matches, modoSniper]);

  // Smart notifications
  useEffect(() => {
    for (const signal of signals) {
      if (shouldNotify(signal) && !notifiedRef.current.has(signal.matchId)) {
        notifiedRef.current.add(signal.matchId);
        markNotified(signal.matchId);
        const style = TIER_STYLES[signal.tier];
        toast({
          title: signal.label,
          description: `${signal.match} - ${signal.minute}' | P:${signal.pressure} SoG:${signal.shotsOnGoal} C:${signal.corners}`,
        });
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification(signal.label, { body: buildNotificationText(signal), icon: '/favicon.ico' }); } catch {}
        }
      }
    }
  }, [signals]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const sniperSignals = signals.filter(s => s.tier === 'SNIPER');
  const semiSignals = signals.filter(s => s.tier === 'SEMI');
  const normalSignals = signals.filter(s => s.tier === 'NORMAL');
  const performance = getHybridPerformance();
  const pendingOps = getHybridPendingOps();
  const allOps = getAllHybridOps();

  const handleEntry = (signal: HybridSignal) => {
    const op = registerHybridEntry(signal);
    if (op) setForceUpdate(n => n + 1);
  };

  const handleResolve = (opId: string, result: 'WIN' | 'LOSS' | 'CASHOUT') => {
    resolveHybridOperation(opId, result);
    setForceUpdate(n => n + 1);
  };

  if (!modoSniper) return null;

  return (
    <div className="rounded-2xl border border-red-500/20 bg-black/40 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-red-500/15 via-yellow-500/10 to-gray-500/5 border-b border-red-500/20">
        <Target className="w-5 h-5 text-red-500" />
        <h2 className="text-sm font-black uppercase tracking-wider text-red-400">
          Modo Híbrido
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          {performance.isBlocked && (
            <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px]">🚫 STOP</Badge>
          )}
          {sniperSignals.length > 0 && (
            <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px]">{sniperSignals.length} 🔥</Badge>
          )}
          {semiSignals.length > 0 && (
            <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 text-[10px]">{semiSignals.length} ⚡</Badge>
          )}
          {normalSignals.length > 0 && (
            <Badge className="bg-gray-500/20 text-gray-300 border-gray-500/30 text-[10px]">{normalSignals.length} 🔍</Badge>
          )}
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
            <p className="text-sm font-black text-white">{performance.dailyCount}/{performance.maxDaily}</p>
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

        {performance.last10.length > 0 && (
          <div className="flex items-center gap-1 mt-2 justify-center">
            <span className="text-[9px] text-gray-500 mr-1">Últimos:</span>
            {performance.last10.map((r, i) => (
              <span key={i} className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                r === 'W' ? 'bg-emerald-500/20 text-emerald-400' :
                r === 'L' ? 'bg-red-500/20 text-red-400' :
                'bg-yellow-500/20 text-yellow-400'
              }`}>{r}</span>
            ))}
          </div>
        )}

        {performance.isBlocked && (
          <div className="mt-2 px-3 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20">
            <p className="text-[10px] text-red-400 font-bold flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> {performance.blockReason}
            </p>
          </div>
        )}
      </div>

      {/* Pending Operations */}
      {pendingOps.length > 0 && (
        <div className="border-b border-white/5">
          <div className="px-4 py-2 bg-blue-500/5">
            <p className="text-[10px] font-bold text-blue-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> OPERAÇÕES ATIVAS ({pendingOps.length})
            </p>
          </div>
          {pendingOps.map(op => (
            <div key={op.id} className="px-4 py-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className={`${TIER_STYLES[op.tier].badgeBg} ${TIER_STYLES[op.tier].text} ${TIER_STYLES[op.tier].border} text-[9px]`}>{op.tier}</Badge>
                  <span className="text-xs font-bold text-white">{op.match}</span>
                  <span className="text-[10px] text-gray-500">{op.minute}'</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleResolve(op.id, 'WIN')} className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[9px] font-bold hover:bg-emerald-500/30">GOL ✅</button>
                  <button onClick={() => handleResolve(op.id, 'CASHOUT')} className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[9px] font-bold hover:bg-yellow-500/30">CASH 💰</button>
                  <button onClick={() => handleResolve(op.id, 'LOSS')} className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-[9px] font-bold hover:bg-red-500/30">LOSS ❌</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SNIPER signals */}
      {sniperSignals.length > 0 && (
        <div className="divide-y divide-white/5">
          {sniperSignals.map(signal => (
            <SignalCard key={signal.matchId} signal={signal} modoLucroReal={modoLucroReal} onEntry={handleEntry} />
          ))}
        </div>
      )}

      {/* SEMI signals */}
      {semiSignals.length > 0 && (
        <div className="divide-y divide-white/5 border-t border-yellow-500/10">
          {semiSignals.map(signal => (
            <SignalCard key={signal.matchId} signal={signal} modoLucroReal={modoLucroReal} onEntry={handleEntry} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {sniperSignals.length === 0 && semiSignals.length === 0 && normalSignals.length === 0 && (
        <div className="px-4 py-6 text-center">
          <Target className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">Nenhum sinal detectado</p>
          <p className="text-[10px] text-gray-600 mt-1">Aguardando jogos ao vivo com dados suficientes</p>
        </div>
      )}

      {/* NORMAL signals (collapsed) */}
      {normalSignals.length > 0 && (
        <div className="border-t border-white/5">
          <button onClick={() => setShowNormal(!showNormal)} className="w-full px-4 py-2 flex items-center justify-between text-[10px] text-gray-500 hover:bg-white/5">
            <span>🔍 {normalSignals.length} oportunidades normais</span>
            {showNormal ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showNormal && (
            <div className="divide-y divide-white/5">
              {normalSignals.slice(0, 8).map(signal => (
                <div key={signal.matchId} className="px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">{signal.match}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500">{signal.minute}'</span>
                      <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-[9px]">🔍</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[9px] text-gray-600">
                    <span>DA: {signal.dangerousAttacks}</span>
                    <span>SoG: {signal.shotsOnGoal}</span>
                    <span>C: {signal.corners}</span>
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
        <button onClick={() => setShowOperations(!showOperations)} className="w-full px-4 py-2 flex items-center justify-between text-[10px] text-gray-500 hover:bg-white/5">
          <span>📋 Histórico ({allOps.length})</span>
          {showOperations ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showOperations && allOps.length > 0 && (
          <div className="max-h-40 overflow-y-auto divide-y divide-white/5">
            {allOps.slice(-10).reverse().map(op => (
              <div key={op.id} className="px-4 py-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className={`${TIER_STYLES[op.tier].badgeBg} ${TIER_STYLES[op.tier].text} ${TIER_STYLES[op.tier].border} text-[9px]`}>{op.tier}</Badge>
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
          <span>Stake: 1% | Max 5/dia | STOP: 2 losses</span>
          <span>🔥 SNIPER | ⚡ SEMI | 🔍 NORMAL</span>
        </div>
      </div>
    </div>
  );
}
