/**
 * MOMENTUM DE PRESSÃO (PI DIFF) — Gráfico de Velas estilo TradingView
 * Candlesticks OHLC em janelas de 5 minutos + EMA + Volume
 */

import { useMemo } from 'react';
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
  volume: number; // absolute movement intensity
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
    // Volume = sum of absolute changes between ticks
    let vol = 0;
    for (let i = 1; i < diffs.length; i++) vol += Math.abs(diffs[i] - diffs[i - 1]);
    vol = Math.max(vol, Math.abs(close - open), 1);

    result.push({
      minute: bucket,
      open,
      high,
      low,
      close,
      isBullish: close >= open,
      volume: +vol.toFixed(1),
    });
  });

  return result;
}

/** Simple EMA */
function calcEMA(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = [];
  let ema: number | null = null;
  data.forEach((v, i) => {
    if (i < period - 1) {
      result.push(null);
    } else if (ema === null) {
      ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result.push(ema);
    } else {
      ema = v * k + ema * (1 - k);
      result.push(ema);
    }
  });
  return result;
}

const MomentumChart = ({ history, homeName, awayName, currentMinute }: Props) => {
  const ohlcData = useMemo(() => buildOHLC(history, 5), [history]);

  const ema3 = useMemo(() => calcEMA(ohlcData.map(d => d.close), 3), [ohlcData]);

  const { yMin, yMax, volMax } = useMemo(() => {
    if (ohlcData.length === 0) return { yMin: -10, yMax: 10, volMax: 5 };
    const allH = ohlcData.map(d => d.high);
    const allL = ohlcData.map(d => d.low);
    const absMax = Math.max(...allH.map(Math.abs), ...allL.map(Math.abs), 5);
    const dm = Math.ceil(absMax * 1.25);
    return {
      yMin: -dm,
      yMax: dm,
      volMax: Math.max(...ohlcData.map(d => d.volume), 1),
    };
  }, [ohlcData]);

  if (ohlcData.length === 0) return null;

  const lastCandle = ohlcData[ohlcData.length - 1];
  const lastMomentum = lastCandle.close;
  const isPositive = lastMomentum >= 0;

  // Layout
  const W = 380;
  const H = 240;
  const padL = 38;
  const padR = 10;
  const padT = 10;
  const volH = 36; // volume section height
  const padB = 22;
  const priceH = H - padT - volH - padB - 4; // gap between price and volume
  const plotW = W - padL - padR;

  const n = ohlcData.length;
  const slotW = plotW / Math.max(n, 1);
  const candleW = Math.min(Math.max(slotW * 0.6, 6), 18);

  const toX = (i: number) => padL + slotW * i + slotW / 2;
  const toY = (v: number) => padT + priceH * (1 - (v - yMin) / (yMax - yMin));
  const toVolY = (v: number) => {
    const base = padT + priceH + 4 + volH;
    return base - (v / volMax) * volH;
  };
  const volBase = padT + priceH + 4 + volH;

  // Y ticks
  const yStep = Math.max(Math.round((yMax) / 3), 1);
  const yTicks: number[] = [];
  for (let v = -yStep * 3; v <= yStep * 3; v += yStep) {
    if (v >= yMin && v <= yMax) yTicks.push(v);
  }

  // EMA path
  const emaPath = useMemo(() => {
    const pts: string[] = [];
    ema3.forEach((v, i) => {
      if (v === null) return;
      const x = toX(i);
      const y = toY(v);
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return pts.join(' ');
  }, [ema3, ohlcData]);

  // Current price line
  const lastY = toY(lastCandle.close);

  return (
    <div className="bg-[#0D1117] rounded-xl overflow-hidden border border-[#21262D]">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-2 border-b border-[#21262D] bg-[#161B22]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">{homeName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] text-[#484F58] font-mono">5min</span>
          <span className="text-[8px] text-yellow-500/60 font-mono">EMA(3)</span>
          <span className="text-[10px] text-gray-500 font-mono bg-[#0D1117] px-1.5 py-0.5 rounded border border-[#21262D]">{currentMinute}'</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">{awayName}</span>
          <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        </div>
      </div>

      {/* Chart */}
      <div className="px-0">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block">
          {/* Background */}
          <rect x={padL} y={padT} width={plotW} height={priceH} fill="#0D1117" rx={0} />

          {/* Grid */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={padL} x2={W - padR}
                y1={toY(v)} y2={toY(v)}
                stroke={v === 0 ? '#30363D' : '#161B22'}
                strokeWidth={v === 0 ? 1 : 0.5}
              />
              <text x={padL - 4} y={toY(v) + 3} textAnchor="end" fontSize={8} fill="#484F58" fontFamily="monospace">
                {v > 0 ? `+${v}` : `${v}`}
              </text>
            </g>
          ))}

          {/* HT line */}
          {ohlcData.some(d => d.minute <= 45) && ohlcData.some(d => d.minute >= 45) && (() => {
            const htIdx = ohlcData.findIndex(d => d.minute >= 45);
            if (htIdx < 0) return null;
            const htX = toX(htIdx);
            return (
              <g>
                <line x1={htX} x2={htX} y1={padT} y2={padT + priceH} stroke="#30363D" strokeDasharray="3 3" strokeWidth={0.8} />
                <text x={htX} y={padT - 2} textAnchor="middle" fontSize={7} fill="#484F58" fontFamily="monospace">HT</text>
              </g>
            );
          })()}

          {/* Current price dashed line */}
          <line
            x1={padL} x2={W - padR}
            y1={lastY} y2={lastY}
            stroke={isPositive ? '#10b981' : '#ef4444'}
            strokeWidth={0.7}
            strokeDasharray="3 2"
            opacity={0.5}
          />
          {/* Price label on right */}
          <rect
            x={W - padR - 32} y={lastY - 7}
            width={32} height={14} rx={2}
            fill={isPositive ? '#10b981' : '#ef4444'}
          />
          <text
            x={W - padR - 16} y={lastY + 3}
            textAnchor="middle" fontSize={8} fill="#fff" fontFamily="monospace" fontWeight="bold"
          >
            {lastMomentum > 0 ? '+' : ''}{lastMomentum.toFixed(1)}
          </text>

          {/* EMA line */}
          {emaPath && (
            <path d={emaPath} fill="none" stroke="#f59e0b" strokeWidth={1.2} opacity={0.7} />
          )}

          {/* CANDLESTICKS */}
          {ohlcData.map((c, i) => {
            const cx = toX(i);
            const highY = toY(c.high);
            const lowY = toY(c.low);
            const openY = toY(c.open);
            const closeY = toY(c.close);
            const bodyTop = Math.min(openY, closeY);
            const bodyBot = Math.max(openY, closeY);
            // Minimum body height for doji visibility
            const rawBodyH = bodyBot - bodyTop;
            const bodyH = Math.max(rawBodyH, 3);
            const adjustedTop = rawBodyH < 3 ? bodyTop - (3 - rawBodyH) / 2 : bodyTop;

            const bull = c.isBullish;
            const bodyFill = bull ? '#26a69a' : '#ef5350';
            const bodyStroke = bull ? '#2edd9f' : '#f77c80';
            const wickColor = bull ? '#26a69a' : '#ef5350';
            const halfW = candleW / 2;
            const isDoji = Math.abs(c.close - c.open) < 0.5;

            return (
              <g key={i}>
                {/* Upper wick */}
                <line
                  x1={cx} x2={cx}
                  y1={highY} y2={adjustedTop}
                  stroke={wickColor} strokeWidth={1.2}
                />
                {/* Lower wick */}
                <line
                  x1={cx} x2={cx}
                  y1={adjustedTop + bodyH} y2={lowY}
                  stroke={wickColor} strokeWidth={1.2}
                />
                {/* Body */}
                {isDoji ? (
                  // Doji cross
                  <>
                    <line
                      x1={cx - halfW} x2={cx + halfW}
                      y1={openY} y2={openY}
                      stroke="#8b949e" strokeWidth={2}
                    />
                  </>
                ) : (
                  <rect
                    x={cx - halfW}
                    y={adjustedTop}
                    width={candleW}
                    height={bodyH}
                    fill={bodyFill}
                    stroke={bodyStroke}
                    strokeWidth={0.5}
                    rx={0.5}
                  />
                )}
              </g>
            );
          })}

          {/* Volume section separator */}
          <line x1={padL} x2={W - padR} y1={padT + priceH + 2} y2={padT + priceH + 2} stroke="#21262D" strokeWidth={0.5} />

          {/* Volume bars */}
          {ohlcData.map((c, i) => {
            const cx = toX(i);
            const barH = (c.volume / volMax) * volH;
            const bull = c.isBullish;
            return (
              <rect
                key={`v${i}`}
                x={cx - candleW / 2}
                y={volBase - barH}
                width={candleW}
                height={barH}
                fill={bull ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)'}
                rx={0.5}
              />
            );
          })}

          {/* VOL label */}
          <text x={padL + 2} y={padT + priceH + 14} fontSize={7} fill="#484F58" fontFamily="monospace">VOL</text>

          {/* X-axis labels */}
          {ohlcData.map((c, i) => {
            // Show every label if few candles, skip alternating if many
            if (n > 12 && i % 2 !== 0) return null;
            return (
              <text
                key={`x${i}`}
                x={toX(i)}
                y={H - 4}
                textAnchor="middle"
                fontSize={8}
                fill="#484F58"
                fontFamily="monospace"
              >
                {c.minute}'
              </text>
            );
          })}
        </svg>
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 flex justify-between items-center border-t border-[#21262D] bg-[#161B22]">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[#484F58] font-mono uppercase tracking-wider">PI OHLC</span>
          <span className="text-[8px] text-[#6e7681] font-mono">
            O:<span className="text-[#c9d1d9]">{lastCandle.open.toFixed(1)}</span>{' '}
            H:<span className="text-emerald-400">{lastCandle.high.toFixed(1)}</span>{' '}
            L:<span className="text-red-400">{lastCandle.low.toFixed(1)}</span>{' '}
            C:<span className={isPositive ? 'text-emerald-400' : 'text-red-400'}>{lastCandle.close.toFixed(1)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-black font-mono tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{lastMomentum.toFixed(1)}
          </span>
          <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
            Math.abs(lastMomentum) >= 20 ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
            Math.abs(lastMomentum) >= 10 ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
            'bg-emerald-500/10 text-emerald-400/60 border border-emerald-500/20'
          }`}>
            {Math.abs(lastMomentum) >= 20 ? 'FORTE' : Math.abs(lastMomentum) >= 10 ? 'MODERADO' : 'LEVE'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default MomentumChart;
