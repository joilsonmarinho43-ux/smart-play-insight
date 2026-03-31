/**
 * MOMENTUM DE PRESSÃO (PI DIFF) — Terminal de Trading Profissional
 * Candlesticks OHLC em janelas de 5 minutos + área de momentum
 */

import { useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import type { PISnapshot } from '@/lib/pressureEngine';

interface Props {
  history: PISnapshot[];
  homeName: string;
  awayName: string;
  currentMinute: number;
}

interface OHLCData {
  minute: number;
  momentum: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ohlc: [number, number, number, number]; // recharts Bar range
  isBullish: boolean;
}

/** Group snapshots into 5-min windows and compute OHLC */
function buildOHLC(history: PISnapshot[], windowSize = 5): OHLCData[] {
  if (history.length === 0) return [];

  const windows: Map<number, PISnapshot[]> = new Map();
  history.forEach((snap) => {
    const bucket = Math.floor(snap.minute / windowSize) * windowSize;
    if (!windows.has(bucket)) windows.set(bucket, []);
    windows.get(bucket)!.push(snap);
  });

  const result: OHLCData[] = [];
  const sortedKeys = [...windows.keys()].sort((a, b) => a - b);

  sortedKeys.forEach((bucket) => {
    const snaps = windows.get(bucket)!;
    const diffs = snaps.map((s) => +(s.homePI - s.awayPI).toFixed(1));
    const open = diffs[0];
    const close = diffs[diffs.length - 1];
    const high = Math.max(...diffs);
    const low = Math.min(...diffs);
    const isBullish = close >= open;

    result.push({
      minute: bucket + Math.floor(windowSize / 2), // center label
      momentum: close,
      open,
      high,
      low,
      close,
      ohlc: [low, open, close, high],
      isBullish,
    });
  });

  return result;
}

/** Custom candlestick shape for recharts Bar */
const CandlestickShape = (props: any) => {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;

  const { open, high, low, close, isBullish } = payload;
  const yScale = props.yAxis || props.background;

  // We need to compute pixel positions from the data values
  // The bar already gives us x, y, width, height for the [low, high] range
  // We need to figure out the scale
  const chartHeight = props.background?.height || 160;
  const chartY = props.background?.y || 10;
  const domain = props.yAxis?.domain || [-30, 30];
  
  // Fallback: use the bar's own positioning
  const barColor = isBullish ? '#10b981' : '#ef4444';
  const wickColor = isBullish ? '#34d399' : '#f87171';

  // The Bar component maps [low, high] to y + height
  // low is at y + height, high is at y
  const totalRange = high - low || 1;
  const barTop = y; // = high position
  const barBottom = y + height; // = low position
  const pixelsPerUnit = height / totalRange || 1;

  // Body = open to close
  const bodyTop = barBottom - (Math.max(open, close) - low) * pixelsPerUnit;
  const bodyBottom = barBottom - (Math.min(open, close) - low) * pixelsPerUnit;
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1.5);

  // Wick center
  const wickX = x + width / 2;

  return (
    <g>
      {/* Upper wick */}
      <line
        x1={wickX}
        y1={barTop}
        x2={wickX}
        y2={bodyTop}
        stroke={wickColor}
        strokeWidth={1}
        opacity={0.8}
      />
      {/* Lower wick */}
      <line
        x1={wickX}
        y1={bodyBottom}
        x2={wickX}
        y2={barBottom}
        stroke={wickColor}
        strokeWidth={1}
        opacity={0.8}
      />
      {/* Body */}
      <rect
        x={x + 1}
        y={bodyTop}
        width={Math.max(width - 2, 3)}
        height={bodyHeight}
        fill={isBullish ? barColor : barColor}
        fillOpacity={isBullish ? 0.9 : 0.9}
        stroke={wickColor}
        strokeWidth={0.5}
        rx={1}
      />
      {/* Glow effect for strong candles */}
      {Math.abs(close - open) > 5 && (
        <rect
          x={x + 1}
          y={bodyTop}
          width={Math.max(width - 2, 3)}
          height={bodyHeight}
          fill={barColor}
          fillOpacity={0.3}
          filter="blur(3px)"
          rx={1}
        />
      )}
    </g>
  );
};

const MomentumChart = ({ history, homeName, awayName, currentMinute }: Props) => {
  const ohlcData = useMemo(() => buildOHLC(history, 5), [history]);

  const lineData = useMemo(() => {
    if (history.length === 0) return [];
    return history.map((snap) => ({
      minute: snap.minute,
      momentum: +(snap.homePI - snap.awayPI).toFixed(1),
    }));
  }, [history]);

  // Merge: use OHLC data as base, overlay line momentum
  const chartData = useMemo(() => {
    if (ohlcData.length === 0) return [];
    // Build a combined dataset keyed by minute
    const map = new Map<number, any>();

    // Line data points
    lineData.forEach((d) => {
      map.set(d.minute, { minute: d.minute, momentum: d.momentum });
    });

    // OHLC candles
    ohlcData.forEach((d) => {
      const existing = map.get(d.minute) || { minute: d.minute };
      map.set(d.minute, {
        ...existing,
        ...d,
        hasCandle: true,
      });
    });

    return [...map.values()].sort((a, b) => a.minute - b.minute);
  }, [ohlcData, lineData]);

  const maxAbs = useMemo(() => {
    if (chartData.length === 0) return 10;
    const allValues = chartData.flatMap((d) => [
      d.momentum ?? 0,
      d.high ?? 0,
      d.low ?? 0,
    ]);
    return Math.max(...allValues.map(Math.abs), 10);
  }, [chartData]);

  const domainMax = Math.ceil(maxAbs * 1.3);

  if (chartData.length === 0) return null;

  const lastMomentum = ohlcData.length > 0
    ? ohlcData[ohlcData.length - 1].close
    : 0;
  const isPositive = lastMomentum >= 0;
  const lastCandle = ohlcData[ohlcData.length - 1];

  return (
    <div className="bg-[#161B22] rounded-xl overflow-hidden border border-[#30363D]">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-2 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">{homeName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] text-[#484F58] font-mono">OHLC 5min</span>
          <span className="text-[10px] text-gray-500 font-mono bg-[#0D1117] px-1.5 py-0.5 rounded">{currentMinute}'</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">{awayName}</span>
          <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        </div>
      </div>

      {/* Chart */}
      <div className="px-1 bg-[#0D1117]">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="piGreenUp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="50%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="piRedDown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="50%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="2 6"
              stroke="rgba(48,54,61,0.4)"
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
              tickFormatter={(v: number) => (v > 0 ? `+${v}` : `${v}`)}
            />

            <ReferenceLine y={0} stroke="#30363D" strokeWidth={1.5} />
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
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-2 text-[10px] text-[#e6edf3] shadow-xl">
                    <div className="font-mono text-[#484F58] mb-1">{label}'</div>
                    {d.hasCandle && (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                        <span className="text-[#484F58]">O:</span>
                        <span className={d.open >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {d.open > 0 ? '+' : ''}{d.open?.toFixed(1)}
                        </span>
                        <span className="text-[#484F58]">H:</span>
                        <span className="text-emerald-400">+{d.high?.toFixed(1)}</span>
                        <span className="text-[#484F58]">L:</span>
                        <span className="text-red-400">{d.low?.toFixed(1)}</span>
                        <span className="text-[#484F58]">C:</span>
                        <span className={d.close >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {d.close > 0 ? '+' : ''}{d.close?.toFixed(1)}
                        </span>
                      </div>
                    )}
                    {d.momentum !== undefined && !d.hasCandle && (
                      <div className="font-mono">
                        PI: <span className={d.momentum >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {d.momentum > 0 ? '+' : ''}{d.momentum?.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {/* Area fills behind candles */}
            <Area
              type="monotone"
              dataKey="momentum"
              stroke="none"
              fill="url(#piGreenUp)"
              fillOpacity={1}
              baseValue={0}
              isAnimationActive={false}
              connectNulls
            />
            <Area
              type="monotone"
              dataKey="momentum"
              stroke="none"
              fill="url(#piRedDown)"
              fillOpacity={1}
              baseValue={0}
              isAnimationActive={false}
              connectNulls
            />
            {/* Momentum line */}
            <Area
              type="monotone"
              dataKey="momentum"
              stroke="#6ee7b7"
              strokeWidth={1}
              strokeOpacity={0.4}
              fill="transparent"
              baseValue={0}
              isAnimationActive={false}
              dot={false}
              connectNulls
            />

            {/* Candlestick bars */}
            <Bar
              dataKey="ohlc"
              barSize={8}
              isAnimationActive={false}
              shape={<CandlestickShape />}
              fill="#10b981"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 flex justify-between items-center border-t border-[#30363D] bg-[#161B22]">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[#484F58] font-mono uppercase tracking-wider">PI OHLC</span>
          {lastCandle && (
            <span className="text-[8px] text-[#484F58] font-mono">
              O:{lastCandle.open.toFixed(0)} H:{lastCandle.high.toFixed(0)} L:{lastCandle.low.toFixed(0)} C:{lastCandle.close.toFixed(0)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-black font-mono tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{lastMomentum.toFixed(1)}
          </span>
          <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
            Math.abs(lastMomentum) >= 20 ? 'bg-red-500/20 text-red-400' :
            Math.abs(lastMomentum) >= 10 ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-emerald-500/10 text-emerald-400/60'
          }`}>
            {Math.abs(lastMomentum) >= 20 ? 'FORTE' : Math.abs(lastMomentum) >= 10 ? 'MODERADO' : 'LEVE'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default MomentumChart;
