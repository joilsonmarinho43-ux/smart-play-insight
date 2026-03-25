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
import { Flag, AlertTriangle } from 'lucide-react';

interface MatchEvent {
  minute: number;
  type: 'goal' | 'yellow_card' | 'red_card' | 'corner' | 'substitution';
  team: 'home' | 'away';
  label?: string;
}

interface Props {
  history: PISnapshot[];
  homeName: string;
  awayName: string;
  currentMinute: number;
  events?: MatchEvent[];
  homeGoals?: number;
  awayGoals?: number;
}

const MomentumChart = ({ history, homeName, awayName, currentMinute, events = [], homeGoals = 0, awayGoals = 0 }: Props) => {
  const chartData = useMemo(() => {
    if (history.length === 0) return [];

    // Interpolate data to fill gaps for smoother chart
    const points = history.map((snap) => ({
      minute: snap.minute,
      momentum: snap.homePI - snap.awayPI,
      homePI: snap.homePI,
      awayPI: snap.awayPI,
    }));

    return points;
  }, [history]);

  if (chartData.length < 2) return null;

  const maxAbs = Math.max(
    ...chartData.map((d) => Math.abs(d.momentum)),
    10
  );
  const domainMax = Math.ceil(maxAbs * 1.3);

  // Generate event markers
  const eventIcons = useMemo(() => {
    if (!events || events.length === 0) return [];
    return events.map((evt, i) => ({
      ...evt,
      key: `${evt.type}-${evt.minute}-${i}`,
    }));
  }, [events]);

  // Generate dotted timeline ticks
  const timelineTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 90; i += 3) {
      ticks.push(i);
    }
    return ticks;
  }, []);

  return (
    <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* Team labels */}
      <div className="flex justify-between items-center px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 rounded-sm bg-blue-600" />
          <span className="text-xs font-bold text-gray-800 tracking-wide">
            {homeName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-800 tracking-wide">
            {awayName}
          </span>
          <span className="w-1 h-5 rounded-sm bg-green-600" />
        </div>
      </div>

      {/* Chart area with split background */}
      <div className="relative mx-2">
        {/* Background split: light blue top, light green bottom */}
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

              <XAxis
                dataKey="minute"
                hide
              />
              <YAxis
                domain={[-domainMax, domainMax]}
                hide
              />

              {/* Center line */}
              <ReferenceLine y={0} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />

              {/* 45' vertical marker */}
              <ReferenceLine
                x={45}
                stroke="rgba(0,0,0,0.12)"
                strokeDasharray="3 3"
              />

              <Tooltip
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#374151',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                }}
                labelFormatter={(v) => `${v}'`}
                formatter={(value: number) => {
                  const label = value > 0 ? homeName : awayName;
                  return [`${label} +${Math.abs(value).toFixed(1)}`, 'Pressão'];
                }}
              />

              {/* Blue fill (home = positive) */}
              <Area
                type="monotone"
                dataKey="momentum"
                stroke="none"
                fill="url(#momentumBlueUp)"
                fillOpacity={1}
                baseValue={0}
                isAnimationActive={false}
              />

              {/* Green fill (away = negative) */}
              <Area
                type="monotone"
                dataKey="momentum"
                stroke="none"
                fill="url(#momentumGreenDown)"
                fillOpacity={1}
                baseValue={0}
                isAnimationActive={false}
              />

              {/* Line stroke for clarity */}
              <Area
                type="monotone"
                dataKey="momentum"
                stroke="#1e40af"
                strokeWidth={1.5}
                fill="transparent"
                baseValue={0}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Event icons layer */}
        {eventIcons.length > 0 && (
          <div className="absolute inset-0 pointer-events-none z-20">
            {eventIcons.map((evt) => {
              const leftPct = Math.min(100, Math.max(0, (evt.minute / 90) * 100));
              const isTop = evt.team === 'home';
              return (
                <div
                  key={evt.key}
                  className="absolute"
                  style={{
                    left: `${leftPct}%`,
                    top: isTop ? '5%' : '85%',
                    transform: 'translateX(-50%)',
                  }}
                >
                  {evt.type === 'goal' && (
                    <span className="text-xs">🚩</span>
                  )}
                  {evt.type === 'yellow_card' && (
                    <span className="inline-block w-2.5 h-3 bg-yellow-400 rounded-[1px]" />
                  )}
                  {evt.type === 'red_card' && (
                    <span className="inline-block w-2.5 h-3 bg-red-500 rounded-[1px]" />
                  )}
                  {evt.type === 'corner' && (
                    <span className="text-[10px]">📐</span>
                  )}
                  {evt.type === 'substitution' && (
                    <span className="text-[10px]">🔄</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dotted timeline footer */}
      <div className="px-3 pb-3 pt-1">
        <div className="relative h-4 flex items-center">
          {/* Dots */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-between">
            {timelineTicks.map((tick) => (
              <span
                key={tick}
                className={`inline-block rounded-full ${
                  tick === 0 || tick === 45 || tick === 90
                    ? 'w-0 h-0' // labels instead of dots for key minutes
                    : 'w-[3px] h-[3px] bg-gray-300'
                }`}
              />
            ))}
          </div>
          {/* Key minute labels */}
          <div className="absolute inset-x-0 top-0 flex justify-between items-center h-full">
            <span className="text-[11px] font-medium text-gray-500">0'</span>
            <span className="text-[11px] font-medium text-gray-500">45'</span>
            <span className="text-[11px] font-medium text-gray-500">90'</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MomentumChart;
