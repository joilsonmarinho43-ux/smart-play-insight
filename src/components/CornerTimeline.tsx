import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { CornerPeriod } from '@/lib/eliteMetrics';

interface Props {
  data: CornerPeriod[];
  currentMinute: number;
}

const CornerTimeline = ({ data, currentMinute }: Props) => {
  if (!data || data.length === 0) return null;

  const chartData = data.map((d, i) => ({
    period: d.period,
    Casa: d.home,
    Fora: d.away,
    isFuture: (i + 1) * 15 > currentMinute,
  }));

  return (
    <div className="bg-[#111827] rounded-xl p-3 border border-white/5">
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={chartData} barGap={1} barSize={8}>
          <XAxis dataKey="period" tick={{ fontSize: 9, fill: '#6b7280' }} />
          <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} width={20} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              fontSize: '11px',
            }}
          />
          <Bar dataKey="Casa" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={entry.isFuture ? 'rgba(239,68,68,0.3)' : '#ef4444'} />
            ))}
          </Bar>
          <Bar dataKey="Fora" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={entry.isFuture ? 'rgba(59,130,246,0.3)' : '#3b82f6'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-center gap-4 mt-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-1.5 rounded-sm bg-red-500" />
          <span className="text-[9px] text-gray-500">Casa (real)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-1.5 rounded-sm bg-blue-500" />
          <span className="text-[9px] text-gray-500">Fora (real)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-1.5 rounded-sm bg-white/10" />
          <span className="text-[9px] text-gray-500">Projeção</span>
        </div>
      </div>
    </div>
  );
};

export default CornerTimeline;
