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
  /** Optional goal probability for HT */
  htGoalProb?: number;
  /** Optional goal probability for FT */
  ftGoalProb?: number;
}

const MomentumChart = ({ history, homeName, awayName, currentMinute, htGoalProb, ftGoalProb }: Props) => {
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

  const timelineTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 90; i += 3) ticks.push(i);
    return ticks;
  }, []);

  if (chartData.length < 2) return null;

  return (
    <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* Team labels */}
      <div className="flex justify-between items-center px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 rounded-sm bg-blue-600" />
          <span className="text-xs font-bold text-gray-800 tracking-wide">{homeName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-800 tracking-wide">{awayName}</span>
          <span className="w-1 h-5 rounded-sm bg-green-600" />
        </div>
      </div>

      {/* Chart area with split background */}
      <div className="relative mx-2">
        <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none z-0">
          <div className="h-1/2 bg-blue-50" />
          <div className="h-1/2 bg-green-50" />
        </div>

        <div className="relative z-10">
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="momentumBlueUp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.9} />
                  <stop offset="45%" stopColor="#3b82f6" stopOpacity={0.7} />
                  <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="transparent" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="momentumGreenDown" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="transparent" stopOpacity={0} />
                  <stop offset="50%" stopColor="#16a34a" stopOpacity={0.1} />
                  <stop offset="55%" stopColor="#16a34a" stopOpacity={0.7} />
                  <stop offset="100%" stopColor="#15803d" stopOpacity={0.9} />
                </linearGradient>
              </defs>

              <XAxis dataKey="minute" hide />
              <YAxis domain={[-domainMax, domainMax]} hide />

              <ReferenceLine y={0} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
              <ReferenceLine x={45} stroke="rgba(0,0,0,0.12)" strokeDasharray="3 3" />

              {/* Tooltip: hover-only, never fixed */}
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1 }}
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#374151',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  pointerEvents: 'none',
                }}
                labelFormatter={(v) => `${v}'`}
                formatter={(value: number, _name: string) => {
                  if (Math.abs(value) < 0.1) return ['Equilibrado', 'Pressão'];
                  const label = value > 0 ? homeName : awayName;
                  return [`${label} +${Math.abs(value).toFixed(1)}`, 'Pressão'];
                }}
              />

              <Area type="monotone" dataKey="momentum" stroke="none" fill="url(#momentumBlueUp)" fillOpacity={1} baseValue={0} isAnimationActive={false} />
              <Area type="monotone" dataKey="momentum" stroke="none" fill="url(#momentumGreenDown)" fillOpacity={1} baseValue={0} isAnimationActive={false} />
              <Area type="monotone" dataKey="momentum" stroke="#1e40af" strokeWidth={1.5} fill="transparent" baseValue={0} isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Dotted timeline footer */}
      <div className="px-3 pb-2 pt-1">
        <div className="relative h-4 flex items-center">
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-between">
            {timelineTicks.map((tick) => (
              <span
                key={tick}
                className={`inline-block rounded-full ${
                  tick === 0 || tick === 45 || tick === 90 ? 'w-0 h-0' : 'w-[3px] h-[3px] bg-gray-300'
                }`}
              />
            ))}
          </div>
          <div className="absolute inset-x-0 top-0 flex justify-between items-center h-full">
            <span className="text-[11px] font-medium text-gray-500">0'</span>
            <span className="text-[11px] font-medium text-gray-500">45'</span>
            <span className="text-[11px] font-medium text-gray-500">90'</span>
          </div>
        </div>
      </div>

      {/* HT/FT Goal Probability Indicators */}
      {(htGoalProb !== undefined || ftGoalProb !== undefined) && (
        <div className="flex gap-2 px-3 pb-3">
          {htGoalProb !== undefined && (
            <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-center">
              <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">% Gol HT</p>
              <p className={`text-lg font-black tabular-nums ${htGoalProb >= 65 ? 'text-blue-700' : 'text-blue-500'}`}>
                {htGoalProb.toFixed(1)}%
              </p>
            </div>
          )}
          {ftGoalProb !== undefined && (
            <div className="flex-1 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">
              <p className="text-[9px] font-bold text-green-600 uppercase tracking-wider">% Gol FT</p>
              <p className={`text-lg font-black tabular-nums ${ftGoalProb >= 65 ? 'text-green-700' : 'text-green-500'}`}>
                {ftGoalProb.toFixed(1)}%
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MomentumChart;
