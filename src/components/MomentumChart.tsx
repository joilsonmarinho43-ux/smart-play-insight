/**
 * MOMENTUM DE PRESSÃO (PI DIFF) — Gráfico de Velas (Candlestick)
 * Candlesticks OHLC puros em janelas de 5 minutos
 */

import { useMemo, useCallback } from 'react';
import type { PISnapshot } from '@/lib/pressureEngine';

interface Props {
  history: PISnapshot[];
  homeName: string;
  awayName: string;
  currentMinute: number;
}

interface OHLCData {
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isBullish: boolean;
}

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

    result.push({
      minute: bucket,
      open,
      high,
      low,
      close,
      isBullish: close >= open,
    });
  });

  return result;
}

const MomentumChart = ({ history, homeName, awayName, currentMinute }: Props) => {
  const ohlcData = useMemo(() => buildOHLC(history, 5), [history]);

  const domainMax = useMemo(() => {
    if (ohlcData.length === 0) return 10;
    const allValues = ohlcData.flatMap((d) => [d.high, d.low]);
    return Math.ceil(Math.max(...allValues.map(Math.abs), 10) * 1.2);
  }, [ohlcData]);

  if (ohlcData.length === 0) return null;

  const lastCandle = ohlcData[ohlcData.length - 1];
  const lastMomentum = lastCandle.close;
  const isPositive = lastMomentum >= 0;

  // Chart dimensions
  const chartW = 340;
  const chartH = 200;
  const padL = 36;
  const padR = 8;
  const padT = 12;
  const padB = 24;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const yMin = -domainMax;
  const yMax = domainMax;

  const toY = useCallback((val: number) => {
    return padT + plotH * (1 - (val - yMin) / (yMax - yMin));
  }, [plotH, yMin, yMax]);

  const candleCount = ohlcData.length;
  const candleW = Math.min(Math.max(plotW / Math.max(candleCount, 1) - 2, 4), 16);
  const gap = (plotW - candleW * candleCount) / Math.max(candleCount, 1);

  const toX = useCallback((i: number) => {
    return padL + gap / 2 + i * (candleW + gap) + candleW / 2;
  }, [gap, candleW]);

  // Y-axis ticks
  const yTicks: number[] = [];
  const step = Math.max(Math.round(domainMax / 3), 1);
  for (let v = -step * 3; v <= step * 3; v += step) {
    if (v >= yMin && v <= yMax) yTicks.push(v);
  }

  return (
    <div className="bg-[#161B22] rounded-xl overflow-hidden border border-[#30363D]">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-2 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">{homeName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] text-[#484F58] font-mono">VELAS 5min</span>
          <span className="text-[10px] text-gray-500 font-mono bg-[#0D1117] px-1.5 py-0.5 rounded">{currentMinute}'</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">{awayName}</span>
          <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        </div>
      </div>

      {/* Candlestick SVG */}
      <div className="px-1 bg-[#0D1117]">
        <svg viewBox={`0 0 ${chartW} ${chartH}`} width="100%" preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={padL}
                x2={chartW - padR}
                y1={toY(v)}
                y2={toY(v)}
                stroke={v === 0 ? '#30363D' : 'rgba(48,54,61,0.3)'}
                strokeWidth={v === 0 ? 1.5 : 0.5}
                strokeDasharray={v === 0 ? undefined : '2 4'}
              />
              <text
                x={padL - 4}
                y={toY(v) + 3}
                textAnchor="end"
                fontSize={8}
                fill="#484F58"
                fontFamily="monospace"
              >
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}

          {/* HT line at 45' if visible */}
          {ohlcData.some(d => d.minute <= 45) && ohlcData.some(d => d.minute >= 45) && (
            <>
              {(() => {
                const htIdx = ohlcData.findIndex(d => d.minute >= 45);
                if (htIdx < 0) return null;
                const htX = toX(htIdx);
                return (
                  <>
                    <line x1={htX} x2={htX} y1={padT} y2={chartH - padB} stroke="#30363D" strokeDasharray="4 4" strokeWidth={0.8} />
                    <text x={htX} y={padT - 2} textAnchor="middle" fontSize={7} fill="#484F58">HT</text>
                  </>
                );
              })()}
            </>
          )}

          {/* Candles */}
          {ohlcData.map((candle, i) => {
            const cx = toX(i);
            const highY = toY(candle.high);
            const lowY = toY(candle.low);
            const openY = toY(candle.open);
            const closeY = toY(candle.close);
            const bodyTop = Math.min(openY, closeY);
            const bodyH = Math.max(Math.abs(openY - closeY), 1.5);
            const bull = candle.isBullish;
            const bodyColor = bull ? '#10b981' : '#ef4444';
            const wickColor = bull ? '#34d399' : '#f87171';
            const halfW = candleW / 2;

            return (
              <g key={i}>
                {/* Upper wick */}
                <line x1={cx} x2={cx} y1={highY} y2={bodyTop} stroke={wickColor} strokeWidth={1} opacity={0.8} />
                {/* Lower wick */}
                <line x1={cx} x2={cx} y1={bodyTop + bodyH} y2={lowY} stroke={wickColor} strokeWidth={1} opacity={0.8} />
                {/* Body */}
                <rect
                  x={cx - halfW}
                  y={bodyTop}
                  width={candleW}
                  height={bodyH}
                  fill={bodyColor}
                  fillOpacity={bull ? 1 : 1}
                  stroke={wickColor}
                  strokeWidth={0.5}
                  rx={1}
                />
                {/* Glow for strong moves */}
                {Math.abs(candle.close - candle.open) > 5 && (
                  <rect
                    x={cx - halfW - 2}
                    y={bodyTop - 2}
                    width={candleW + 4}
                    height={bodyH + 4}
                    fill={bodyColor}
                    fillOpacity={0.25}
                    rx={3}
                  />
                )}
              </g>
            );
          })}

          {/* X-axis labels */}
          {ohlcData.map((candle, i) => (
            <text
              key={i}
              x={toX(i)}
              y={chartH - padB + 14}
              textAnchor="middle"
              fontSize={8}
              fill="#484F58"
              fontFamily="monospace"
            >
              {candle.minute}'
            </text>
          ))}
        </svg>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 flex justify-between items-center border-t border-[#30363D] bg-[#161B22]">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[#484F58] font-mono uppercase tracking-wider">PI OHLC</span>
          <span className="text-[8px] text-[#484F58] font-mono">
            O:{lastCandle.open.toFixed(0)} H:{lastCandle.high.toFixed(0)} L:{lastCandle.low.toFixed(0)} C:{lastCandle.close.toFixed(0)}
          </span>
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
