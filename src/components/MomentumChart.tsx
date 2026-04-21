/**
 * MOMENTUM DE PRESSÃO — Candlestick estilo TradingView (OHLC real)
 * Cada vela = janela de 3 minutos do PI Diff (Home - Away).
 * Open/High/Low/Close calculados a partir dos snapshots,
 * com micro-variação sintética determinística para garantir wicks visíveis
 * mesmo quando o intervalo tem poucos ticks.
 */

import { useMemo } from 'react';
import type { PISnapshot } from '@/lib/pressureEngine';

interface Props {
  history: PISnapshot[];
  homeName: string;
  awayName: string;
  currentMinute: number;
}

interface Candle {
  bucket: number;       // minuto inicial da janela
  open: number;
  high: number;
  low: number;
  close: number;
  isBullish: boolean;
  volume: number;
}

const WINDOW = 3; // tamanho da janela em minutos (mais candles, mais "trade")

/** PRNG determinístico (mulberry32) — wicks sempre iguais para o mesmo bucket */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCandles(history: PISnapshot[]): Candle[] {
  if (history.length === 0) return [];

  // 1. Agrupa snapshots por bucket de WINDOW minutos
  const buckets = new Map<number, PISnapshot[]>();
  history.forEach((s) => {
    const b = Math.floor(s.minute / WINDOW) * WINDOW;
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(s);
  });

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const out: Candle[] = [];

  keys.forEach((b, idx) => {
    const snaps = buckets.get(b)!;
    const diffs = snaps.map((s) => s.homePI - s.awayPI);

    // Open = último close anterior (continuidade) OU primeiro diff
    const prev = out[out.length - 1];
    const open = prev ? prev.close : diffs[0];
    const close = diffs[diffs.length - 1];

    // High/Low base
    let high = Math.max(open, close, ...diffs);
    let low = Math.min(open, close, ...diffs);

    // 2. Sintetiza wicks quando temos poucos pontos no bucket
    // Volatilidade local proporcional à magnitude do movimento + base mínima
    const move = Math.abs(close - open);
    const baseVol = Math.max(move * 0.8, 1.2);
    const rng = seeded(b * 9973 + Math.round((open + close) * 100));
    const wickUp = baseVol * (0.4 + rng() * 0.9);
    const wickDn = baseVol * (0.4 + rng() * 0.9);

    high = Math.max(high, Math.max(open, close) + wickUp);
    low = Math.min(low, Math.min(open, close) - wickDn);

    // Volume = soma absoluta de movimentos + amplitude
    let vol = Math.abs(close - open) + (high - low) * 0.5;
    for (let i = 1; i < diffs.length; i++) vol += Math.abs(diffs[i] - diffs[i - 1]);
    vol = Math.max(vol, 1);

    out.push({
      bucket: b,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      isBullish: close >= open,
      volume: +vol.toFixed(2),
    });
  });

  return out;
}

/** EMA simples */
function calcEMA(data: number[], period: number): (number | null)[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  data.forEach((v, i) => {
    if (i < period - 1) {
      out.push(null);
    } else if (ema === null) {
      ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out.push(ema);
    } else {
      ema = v * k + ema * (1 - k);
      out.push(ema);
    }
  });
  return out;
}

const MomentumChart = ({ history, homeName, awayName, currentMinute }: Props) => {
  const candles = useMemo(() => buildCandles(history), [history]);
  const ema5 = useMemo(() => calcEMA(candles.map((c) => c.close), 5), [candles]);

  const { yMin, yMax, volMax } = useMemo(() => {
    if (candles.length === 0) return { yMin: -8, yMax: 8, volMax: 5 };
    const allH = candles.map((c) => c.high);
    const allL = candles.map((c) => c.low);
    const absMax = Math.max(...allH.map(Math.abs), ...allL.map(Math.abs), 4);
    const padded = Math.ceil(absMax * 1.2);
    return {
      yMin: -padded,
      yMax: padded,
      volMax: Math.max(...candles.map((c) => c.volume), 1),
    };
  }, [candles]);

  if (candles.length === 0) {
    return (
      <div className="bg-[#0D1117] rounded-xl border border-[#21262D] p-6 text-center">
        <span className="text-[10px] text-[#6e7681] font-mono uppercase tracking-wider">
          Aguardando dados de pressão...
        </span>
      </div>
    );
  }

  const last = candles[candles.length - 1];
  const lastMomentum = last.close;
  const isPositive = lastMomentum >= 0;

  // Layout (eixo Y à DIREITA — TradingView style)
  const W = 380;
  const H = 260;
  const padL = 6;
  const padR = 42;       // Y-axis na direita
  const padT = 12;
  const padB = 22;
  const volH = 38;
  const gapPV = 6;
  const priceH = H - padT - volH - padB - gapPV;
  const plotW = W - padL - padR;

  const n = candles.length;
  const slotW = plotW / Math.max(n, 1);
  const candleW = Math.min(Math.max(slotW * 0.7, 5), 16);

  const toX = (i: number) => padL + slotW * i + slotW / 2;
  const toY = (v: number) => padT + priceH * (1 - (v - yMin) / (yMax - yMin));
  const volBase = padT + priceH + gapPV + volH;
  const toVolY = (v: number) => volBase - (v / volMax) * volH;

  // Y ticks (linhas guia)
  const yTicks: number[] = [];
  const tickStep = Math.max(Math.ceil(yMax / 3), 1);
  for (let v = -tickStep * 4; v <= tickStep * 4; v += tickStep) {
    if (v >= yMin && v <= yMax) yTicks.push(v);
  }

  // EMA path
  const emaPath = (() => {
    const pts: string[] = [];
    ema5.forEach((v, i) => {
      if (v === null) return;
      const x = toX(i);
      const y = toY(v);
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return pts.join(' ');
  })();

  const lastY = toY(last.close);

  // HT marker
  const htIdx = candles.findIndex((c) => c.bucket >= 45);

  return (
    <div className="bg-[#0D1117] rounded-xl overflow-hidden border border-[#21262D] shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-2 border-b border-[#21262D] bg-[#161B22]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider truncate max-w-[80px]">
            {homeName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] text-[#484F58] font-mono px-1 border border-[#21262D] rounded">
            {WINDOW}m
          </span>
          <span className="text-[8px] text-[#f59e0b] font-mono">EMA5</span>
          <span className="text-[10px] text-gray-400 font-mono bg-[#0D1117] px-1.5 py-0.5 rounded border border-[#21262D]">
            {currentMinute}'
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider truncate max-w-[80px]">
            {awayName}
          </span>
          <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]" />
        </div>
      </div>

      {/* Chart SVG */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block bg-[#0D1117]">
        {/* === GRID === */}
        {yTicks.map((v) => (
          <g key={`g${v}`}>
            <line
              x1={padL}
              x2={W - padR}
              y1={toY(v)}
              y2={toY(v)}
              stroke={v === 0 ? '#30363D' : '#161B22'}
              strokeWidth={v === 0 ? 1 : 0.6}
              strokeDasharray={v === 0 ? '0' : '2 3'}
            />
          </g>
        ))}

        {/* HT vertical marker */}
        {htIdx >= 0 && (
          <g>
            <line
              x1={toX(htIdx)}
              x2={toX(htIdx)}
              y1={padT}
              y2={padT + priceH}
              stroke="#30363D"
              strokeDasharray="3 3"
              strokeWidth={0.8}
            />
            <text
              x={toX(htIdx)}
              y={padT + 8}
              textAnchor="middle"
              fontSize={7}
              fill="#6e7681"
              fontFamily="ui-monospace, monospace"
            >
              HT
            </text>
          </g>
        )}

        {/* Current price dashed crosshair */}
        <line
          x1={padL}
          x2={W - padR}
          y1={lastY}
          y2={lastY}
          stroke={isPositive ? '#26a69a' : '#ef5350'}
          strokeWidth={0.8}
          strokeDasharray="2 3"
          opacity={0.55}
        />

        {/* === EMA === */}
        {emaPath && (
          <path
            d={emaPath}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1.3}
            opacity={0.85}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* === CANDLESTICKS === */}
        {candles.map((c, i) => {
          const cx = toX(i);
          const yHigh = toY(c.high);
          const yLow = toY(c.low);
          const yOpen = toY(c.open);
          const yClose = toY(c.close);
          const bull = c.isBullish;
          const bodyTop = Math.min(yOpen, yClose);
          const bodyBot = Math.max(yOpen, yClose);
          const rawH = bodyBot - bodyTop;
          const bodyH = Math.max(rawH, 2.5);
          const adjTop = rawH < 2.5 ? bodyTop - (2.5 - rawH) / 2 : bodyTop;

          const fill = bull ? '#26a69a' : '#ef5350';
          const stroke = bull ? '#4ec9b0' : '#ff7a7a';
          const halfW = candleW / 2;
          const isDoji = Math.abs(c.close - c.open) < 0.15;

          return (
            <g key={`c${i}`}>
              {/* Wick (mecha) — uma linha contínua atravessando o body */}
              <line
                x1={cx}
                x2={cx}
                y1={yHigh}
                y2={yLow}
                stroke={fill}
                strokeWidth={1}
              />
              {/* Body */}
              {isDoji ? (
                <line
                  x1={cx - halfW}
                  x2={cx + halfW}
                  y1={yOpen}
                  y2={yOpen}
                  stroke="#c9d1d9"
                  strokeWidth={1.6}
                />
              ) : (
                <rect
                  x={cx - halfW}
                  y={adjTop}
                  width={candleW}
                  height={bodyH}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={0.6}
                  rx={0.5}
                />
              )}
            </g>
          );
        })}

        {/* === Y-AXIS RIGHT (TradingView style) === */}
        <line
          x1={W - padR}
          x2={W - padR}
          y1={padT}
          y2={padT + priceH}
          stroke="#21262D"
          strokeWidth={1}
        />
        {yTicks.map((v) => (
          <text
            key={`yl${v}`}
            x={W - padR + 3}
            y={toY(v) + 3}
            fontSize={8}
            fill="#6e7681"
            fontFamily="ui-monospace, monospace"
          >
            {v > 0 ? `+${v}` : `${v}`}
          </text>
        ))}

        {/* Price tag (último valor — destaque) */}
        <rect
          x={W - padR + 1}
          y={lastY - 7}
          width={padR - 2}
          height={14}
          rx={2}
          fill={isPositive ? '#26a69a' : '#ef5350'}
        />
        <text
          x={W - padR + (padR - 2) / 2 + 1}
          y={lastY + 3}
          textAnchor="middle"
          fontSize={9}
          fill="#fff"
          fontFamily="ui-monospace, monospace"
          fontWeight="700"
        >
          {lastMomentum > 0 ? '+' : ''}
          {lastMomentum.toFixed(1)}
        </text>

        {/* === VOLUME SECTION === */}
        <line
          x1={padL}
          x2={W - padR}
          y1={padT + priceH + gapPV / 2}
          y2={padT + priceH + gapPV / 2}
          stroke="#21262D"
          strokeWidth={0.5}
        />
        {candles.map((c, i) => {
          const cx = toX(i);
          const barH = Math.max((c.volume / volMax) * volH, 1);
          const bull = c.isBullish;
          return (
            <rect
              key={`v${i}`}
              x={cx - candleW / 2}
              y={volBase - barH}
              width={candleW}
              height={barH}
              fill={bull ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)'}
              rx={0.5}
            />
          );
        })}
        <text
          x={padL + 2}
          y={padT + priceH + gapPV + 8}
          fontSize={7}
          fill="#6e7681"
          fontFamily="ui-monospace, monospace"
        >
          VOL
        </text>

        {/* === X-axis labels === */}
        {candles.map((c, i) => {
          const skip = n > 12 ? 2 : n > 8 ? 1 : 0;
          if (skip > 0 && i % (skip + 1) !== 0 && i !== n - 1) return null;
          return (
            <text
              key={`x${i}`}
              x={toX(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize={8}
              fill="#6e7681"
              fontFamily="ui-monospace, monospace"
            >
              {c.bucket}'
            </text>
          );
        })}
      </svg>

      {/* Footer */}
      <div className="px-3 py-1.5 flex justify-between items-center border-t border-[#21262D] bg-[#161B22]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[9px] text-[#6e7681] font-mono uppercase tracking-wider">PI·OHLC</span>
          <span className="text-[8px] text-[#6e7681] font-mono truncate">
            O:<span className="text-[#c9d1d9]">{last.open.toFixed(1)}</span>{' '}
            H:<span className="text-emerald-400">{last.high.toFixed(1)}</span>{' '}
            L:<span className="text-red-400">{last.low.toFixed(1)}</span>{' '}
            C:<span className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
              {last.close.toFixed(1)}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-black font-mono tabular-nums ${
              isPositive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {isPositive ? '+' : ''}
            {lastMomentum.toFixed(1)}
          </span>
          <span
            className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
              Math.abs(lastMomentum) >= 20
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : Math.abs(lastMomentum) >= 10
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                : 'bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/20'
            }`}
          >
            {Math.abs(lastMomentum) >= 20
              ? 'FORTE'
              : Math.abs(lastMomentum) >= 10
              ? 'MODERADO'
              : 'LEVE'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default MomentumChart;
