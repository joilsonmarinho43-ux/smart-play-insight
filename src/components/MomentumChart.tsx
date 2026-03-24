import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
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

    // Build data points: home goes positive (up), away goes negative (down)
    return history.map((snap) => ({
      minute: snap.minute,
      momentum: snap.homePI - snap.awayPI, // positive = home dominance, negative = away
      homePI: snap.homePI,
      awayPI: snap.awayPI,
    }));
  }, [history]);

  if (chartData.length < 2) return null;

  const maxAbs = Math.max(
    ...chartData.map((d) => Math.abs(d.momentum)),
    10
  );
  const domainMax = Math.ceil(maxAbs * 1.2);

  return (
    <div className="bg-[#111827] rounded-xl p-3 border border-white/5">
      {/* Team labels */}
      <div className="flex justify-between items-center mb-1 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-3 rounded-sm bg-blue-500" />
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">
            {homeName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">
            {awayName}
          </span>
          <span className="w-2 h-3 rounded-sm bg-emerald-500" />
        </div>
      </div>

      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <defs>
            <linearGradient id="momentumUp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.6} />
              <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.05} />
              <stop offset="100%" stopColor="transparent" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="momentumDown" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="transparent" stopOpacity={0} />
              <stop offset="50%" stopColor="#10b981" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.6} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="minute"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={(v) => `${v}'`}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={false}
          />
          <YAxis
            domain={[-domainMax, domainMax]}
            hide
          />

          {/* Center line */}
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />

          {/* 45' marker */}
          <ReferenceLine
            x={45}
            stroke="rgba(255,255,255,0.15)"
            strokeDasharray="3 3"
            label={{ value: '45\'', position: 'top', fontSize: 9, fill: '#6b7280' }}
          />

          <Tooltip
            contentStyle={{
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              fontSize: '11px',
            }}
            labelFormatter={(v) => `${v}'`}
            formatter={(value: number, name: string) => {
              if (name === 'momentum') {
                const label = value > 0 ? homeName : awayName;
                return [`${label} +${Math.abs(value).toFixed(1)}`, 'Momentum'];
              }
              return [value, name];
            }}
          />

          <Area
            type="monotone"
            dataKey="momentum"
            stroke="none"
            fill="url(#momentumUp)"
            fillOpacity={1}
            baseValue={0}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="momentum"
            stroke="none"
            fill="url(#momentumDown)"
            fillOpacity={1}
            baseValue={0}
            isAnimationActive={false}
          />

          {/* Line on top for visual clarity */}
          <Area
            type="monotone"
            dataKey="momentum"
            stroke="#3b82f6"
            strokeWidth={1.5}
            fill="transparent"
            baseValue={0}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Timeline footer */}
      <div className="flex justify-between px-2 mt-1">
        <span className="text-[9px] text-gray-600">0'</span>
        <span className="text-[9px] text-gray-600">45'</span>
        <span className="text-[9px] text-gray-600">90'</span>
      </div>
    </div>
  );
};

export default MomentumChart;
