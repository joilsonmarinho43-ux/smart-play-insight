import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { CornerPeriod } from '@/lib/eliteMetrics';
import React from 'react';

interface Props {
  data: CornerPeriod[];
  currentMinute: number;
}

const CustomBar = React.forwardRef<SVGRectElement, any>((props, ref) => {
  const { x, y, width, height, fill } = props;
  if (!height || height <= 0) return null;
  return <rect ref={ref} x={x} y={y} width={width} height={height} fill={fill} rx={4} ry={4} />;
});
CustomBar.displayName = 'CustomBar';

const CornerTimeline = ({ data, currentMinute }: Props) => {
  if (!data || data.length === 0) return null;

  const chartData = data.map((d, i) => ({
    period: d.period,
    Casa: d.home,
    Fora: d.away,
    isFuture: (i + 1) * 15 > currentMinute,
  }));

  const totalHome = Math.round(data.reduce((s, d) => s + d.home, 0) * 10) / 10;
  const totalAway = Math.round(data.reduce((s, d) => s + d.away, 0) * 10) / 10;

  return (
    <div className="bg-gradient-to-br from-[#0D1117] to-[#111827] rounded-xl p-4 border border-[#1e293b] shadow-lg shadow-black/30">
      {/* Summary badges */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-red-500/15 px-2.5 py-1 rounded-lg border border-red-500/20">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-[10px] font-bold text-red-400">Casa: {totalHome}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-blue-500/15 px-2.5 py-1 rounded-lg border border-blue-500/20">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-[10px] font-bold text-blue-400">Fora: {totalAway}</span>
          </div>
        </div>
        <div className="bg-[#1e293b] px-2 py-1 rounded-lg">
          <span className="text-[10px] font-bold text-gray-300">Total: {totalHome + totalAway}</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData} barGap={2} barSize={10}>
          <XAxis
            dataKey="period"
            tick={{ fontSize: 9, fill: '#6b7280' }}
            axisLine={{ stroke: '#1e293b' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#6b7280' }}
            width={20}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: '10px',
              fontSize: '11px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          />
          <Bar dataKey="Casa" shape={<CustomBar />}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={entry.isFuture ? 'rgba(239,68,68,0.2)' : '#ef4444'} />
            ))}
          </Bar>
          <Bar dataKey="Fora" shape={<CustomBar />}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={entry.isFuture ? 'rgba(59,130,246,0.2)' : '#3b82f6'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex justify-center gap-5 mt-2">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-red-500" />
          <span className="text-[9px] text-gray-500">Casa (real)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-blue-500" />
          <span className="text-[9px] text-gray-500">Fora (real)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-white/10 border border-dashed border-white/20" />
          <span className="text-[9px] text-gray-500">Projeção</span>
        </div>
      </div>
    </div>
  );
};

export default CornerTimeline;
