/**
 * MOMENTUM DE PRESSÃO (PI DIFF) — Estilo Trading Financeiro
 * Plota a diferença de pressão (Home - Away) minuto a minuto
 * Área superior verde (mandante domina), inferior vermelha (visitante domina)
 * Mantém histórico de toda a partida
 */

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type { PISnapshot } from '@/lib/pressureEngine';

interface Props {
  history: PISnapshot[];
  homeName: string;
  awayName: string;
  currentMinute: number;
}

const MomentumChart = ({ history, homeName, awayName, currentMinute }: Props) => {
  const chartData = useMemo(() => {
    if (history.length === 0) return [];
    return history.map((snap) => ({
      minute: snap.minute,
      momentum: +(snap.homePI - snap.awayPI).toFixed(1),
      homePI: snap.homePI,
      awayPI: snap.awayPI,
    }));
  }, [history]);

  const maxAbs = useMemo(() => {
    if (chartData.length === 0) return 10;
    return Math.max(...chartData.map((d) => Math.abs(d.momentum)), 10);
  }, [chartData]);

  const domainMax = Math.ceil(maxAbs * 1.3);

  if (chartData.length < 2) return null;

  return (
    <div className="bg-[#161B22] rounded-xl overflow-hidden border border-[#30363D]">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-2 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">{homeName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] text-[#30363D] font-mono">PI DIFF</span>
          <span className="text-[10px] text-gray-500 font-mono bg-[#0D1117] px-1.5 py-0.5 rounded">{currentMinute}'</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">{awayName}</span>
          <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        </div>
      </div>

      {/* Chart */}
      <div className="px-1 bg-[#0D1117]">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="piGreenUp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                <stop offset="40%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="50%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="piRedDown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="50%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="60%" stopColor="#ef4444" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.45} />
              </linearGradient>
              <linearGradient id="piStrokeLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="50%" stopColor="#6ee7b7" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="2 6"
              stroke="rgba(48,54,61,0.5)"
              vertical={false}
            />

            <XAxis
              dataKey="minute"
              tick={{ fontSize: 9, fill: '#484F58' }}
              tickFormatter={(v) => `${v}'`}
              axisLine={{ stroke: '#30363D' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[-domainMax, domainMax]}
              tick={{ fontSize: 9, fill: '#484F58' }}
              axisLine={false}
              tickLine={false}
              width={30}
              tickFormatter={(v) => v > 0 ? `+${v}` : `${v}`}
            />

            {/* Zero line */}
            <ReferenceLine y={0} stroke="#30363D" strokeWidth={1.5} />
            
            {/* Half-time marker */}
            <ReferenceLine
              x={45}
              stroke="#30363D"
              strokeDasharray="4 4"
              label={{ value: 'HT', position: 'top', fontSize: 8, fill: '#484F58' }}
            />

            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: 'rgba(139,148,158,0.3)', strokeWidth: 1, strokeDasharray: '4 4' }}
              contentStyle={{
                background: '#161B22',
                border: '1px solid #30363D',
                borderRadius: '8px',
                fontSize: '10px',
                color: '#e6edf3',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                padding: '8px 12px',
              }}
              labelFormatter={(v) => `${v}'`}
              formatter={(value: number) => {
                if (Math.abs(value) < 0.5) return ['Equilibrado', 'PI Diff'];
                const label = value > 0 ? `↑ ${homeName}` : `↓ ${awayName}`;
                return [`${label} ${value > 0 ? '+' : ''}${value.toFixed(1)}`, 'PI Diff'];
              }}
            />

            {/* Green fill (positive = home dominance) */}
            <Area
              type="monotone"
              dataKey="momentum"
              stroke="none"
              fill="url(#piGreenUp)"
              fillOpacity={1}
              baseValue={0}
              isAnimationActive={false}
            />
            {/* Red fill (negative = away dominance) */}
            <Area
              type="monotone"
              dataKey="momentum"
              stroke="none"
              fill="url(#piRedDown)"
              fillOpacity={1}
              baseValue={0}
              isAnimationActive={false}
            />
            {/* Main line */}
            <Area
              type="monotone"
              dataKey="momentum"
              stroke="url(#piStrokeLine)"
              strokeWidth={2}
              fill="transparent"
              baseValue={0}
              isAnimationActive={false}
              dot={false}
              activeDot={{
                r: 4,
                fill: '#10b981',
                stroke: '#0D1117',
                strokeWidth: 2,
                filter: 'drop-shadow(0 0 4px rgba(16,185,129,0.6))',
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Footer — PI Case score */}
      <div className="px-3 py-2 flex justify-between items-center border-t border-[#30363D] bg-[#161B22]">
        <span className="text-[9px] text-[#484F58] font-mono uppercase tracking-wider">PI Diff</span>
        {chartData.length > 0 && (() => {
          const last = chartData[chartData.length - 1].momentum;
          const isPositive = last >= 0;
          return (
            <div className="flex items-center gap-2">
              <span className={`text-xs font-black font-mono tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPositive ? '+' : ''}{last.toFixed(1)}
              </span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
                Math.abs(last) >= 20 ? 'bg-red-500/20 text-red-400' :
                Math.abs(last) >= 10 ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-emerald-500/10 text-emerald-400/60'
              }`}>
                {Math.abs(last) >= 20 ? 'FORTE' : Math.abs(last) >= 10 ? 'MODERADO' : 'LEVE'}
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default MomentumChart;
