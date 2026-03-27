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
      momentum: snap.homePI - snap.awayPI,
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
    <div className="bg-[#0d1117] rounded-xl overflow-hidden border border-white/10">
      {/* Header — trading style */}
      <div className="flex justify-between items-center px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">{homeName}</span>
        </div>
        <span className="text-[9px] text-gray-500 font-mono">{currentMinute}'</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">{awayName}</span>
          <span className="w-2 h-2 rounded-full bg-red-500" />
        </div>
      </div>

      {/* Chart */}
      <div className="px-1">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={chartData} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="tradingGreenUp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                <stop offset="50%" stopColor="#10b981" stopOpacity={0.05} />
                <stop offset="100%" stopColor="transparent" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="tradingRedDown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="transparent" stopOpacity={0} />
                <stop offset="50%" stopColor="#ef4444" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.04)"
              vertical={false}
            />

            <XAxis
              dataKey="minute"
              tick={{ fontSize: 9, fill: '#6b7280' }}
              tickFormatter={(v) => `${v}'`}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[-domainMax, domainMax]}
              tick={{ fontSize: 9, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
              width={28}
              tickFormatter={(v) => v > 0 ? `+${v}` : `${v}`}
            />

            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            <ReferenceLine x={45} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" label={{ value: 'HT', position: 'top', fontSize: 8, fill: '#6b7280' }} />

            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1, strokeDasharray: '4 4' }}
              contentStyle={{
                background: '#1a1f2e',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '10px',
                color: '#e5e7eb',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}
              labelFormatter={(v) => `${v}'`}
              formatter={(value: number) => {
                if (Math.abs(value) < 0.1) return ['Equilibrado', 'Momentum'];
                const label = value > 0 ? homeName : awayName;
                return [`${label} +${Math.abs(value).toFixed(1)}`, 'Momentum'];
              }}
            />

            <Area type="monotone" dataKey="momentum" stroke="none" fill="url(#tradingGreenUp)" fillOpacity={1} baseValue={0} isAnimationActive={false} />
            <Area type="monotone" dataKey="momentum" stroke="none" fill="url(#tradingRedDown)" fillOpacity={1} baseValue={0} isAnimationActive={false} />
            <Area
              type="monotone"
              dataKey="momentum"
              stroke="#10b981"
              strokeWidth={2}
              fill="transparent"
              baseValue={0}
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 3, fill: '#10b981', stroke: '#0d1117', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Footer — current value */}
      <div className="px-3 pb-2 flex justify-between items-center">
        <span className="text-[9px] text-gray-500 font-mono">PI Diff</span>
        {chartData.length > 0 && (() => {
          const last = chartData[chartData.length - 1].momentum;
          const isPositive = last >= 0;
          return (
            <span className={`text-xs font-bold font-mono tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {isPositive ? '+' : ''}{last.toFixed(1)}
            </span>
          );
        })()}
      </div>
    </div>
  );
};

export default MomentumChart;
