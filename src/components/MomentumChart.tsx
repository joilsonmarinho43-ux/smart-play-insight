/**
 * MOMENTUM DE PRESSÃO — Estilo SofaScore Pressure Chart
 * Gráfico de área com pressão home (azul para cima) e away (verde para baixo).
 * Timeline de 0' a 90' com marcador de HT aos 45'.
 */

import { useMemo } from 'react';
import type { PISnapshot } from '@/lib/pressureEngine';

interface Props {
  history: PISnapshot[];
  homeName: string;
  awayName: string;
  currentMinute: number;
}

/**
 * Normaliza os snapshots em pontos de pressão relativa (-1 a 1)
 * Positivo = home dominando, Negativo = away dominando
 */
function buildPressureLine(history: PISnapshot[]): { minute: number; value: number }[] {
  if (history.length === 0) return [];

  return history.map((s) => {
    const total = s.homePI + s.awayPI;
    if (total === 0) return { minute: s.minute, value: 0 };
    // Normaliza: +1 = 100% home, -1 = 100% away
    const value = (s.homePI - s.awayPI) / total;
    return { minute: s.minute, value };
  });
}

const MomentumChart = ({ history, homeName, awayName, currentMinute }: Props) => {
  const points = useMemo(() => buildPressureLine(history), [history]);

  if (points.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <span className="text-[11px] text-gray-400 font-medium">
          Aguardando dados de pressão...
        </span>
      </div>
    );
  }

  // Layout
  const W = 400;
  const H = 160;
  const padL = 8;
  const padR = 8;
  const padT = 28; // space for event icons top
  const padB = 32; // space for event icons bottom + timeline
  const chartH = H - padT - padB;
  const plotW = W - padL - padR;
  const midY = padT + chartH / 2;

  // Map minute (0-90) → X
  const maxMin = Math.max(currentMinute, 90);
  const toX = (min: number) => padL + (min / maxMin) * plotW;
  // Map value (-1 to 1) → Y  (1 = top, -1 = bottom)
  const toY = (v: number) => midY - v * (chartH / 2);

  // Build area path for home (above center) and away (below center)
  // We create TWO separate filled areas: one clipped above midY, one below
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.minute).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(' ');

  // For smooth look, extend to current minute if last point is behind
  const lastPt = points[points.length - 1];

  // Upper area (home pressure) — fill from line to midY, clip above
  const upperArea =
    linePath +
    ` L${toX(lastPt.minute).toFixed(1)},${midY} L${toX(points[0].minute).toFixed(1)},${midY} Z`;

  // We'll use clip paths to separate upper and lower fills

  // Timeline dots
  const timelineDots: number[] = [];
  for (let m = 0; m <= 90; m += 3) timelineDots.push(m);

  // HT position
  const htX = toX(45);

  return (
    <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block"
      >
        <defs>
          {/* Clip for upper half (home) */}
          <clipPath id="clipUpper">
            <rect x={padL} y={padT} width={plotW} height={chartH / 2} />
          </clipPath>
          {/* Clip for lower half (away) */}
          <clipPath id="clipLower">
            <rect x={padL} y={midY} width={plotW} height={chartH / 2} />
          </clipPath>
        </defs>

        {/* Background zones */}
        {/* Upper (home) — light blue */}
        <rect x={padL} y={padT} width={plotW} height={chartH / 2} fill="#dbeafe" rx={0} />
        {/* Lower (away) — light green */}
        <rect x={padL} y={midY} width={plotW} height={chartH / 2} fill="#dcfce7" rx={0} />

        {/* Center line */}
        <line
          x1={padL}
          x2={padL + plotW}
          y1={midY}
          y2={midY}
          stroke="#e5e7eb"
          strokeWidth={1}
        />

        {/* HT vertical dotted line */}
        <line
          x1={htX}
          x2={htX}
          y1={padT}
          y2={padT + chartH}
          stroke="#d1d5db"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {/* Filled area — home (blue, clipped upper) */}
        <path
          d={
            `M${toX(points[0].minute).toFixed(1)},${midY} ` +
            points.map((p) => `L${toX(p.minute).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
            ` L${toX(lastPt.minute).toFixed(1)},${midY} Z`
          }
          fill="#3b82f6"
          opacity={0.85}
          clipPath="url(#clipUpper)"
        />

        {/* Filled area — away (green, clipped lower) */}
        <path
          d={
            `M${toX(points[0].minute).toFixed(1)},${midY} ` +
            points.map((p) => `L${toX(p.minute).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
            ` L${toX(lastPt.minute).toFixed(1)},${midY} Z`
          }
          fill="#22c55e"
          opacity={0.85}
          clipPath="url(#clipLower)"
        />

        {/* Pressure line (darker stroke on top) */}
        <path
          d={
            points
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.minute).toFixed(1)},${toY(p.value).toFixed(1)}`)
              .join(' ')
          }
          fill="none"
          stroke="#1e3a5f"
          strokeWidth={1.2}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.3}
        />

        {/* Timeline markers — dotted line at bottom */}
        {timelineDots.map((m) => (
          <circle
            key={`dot${m}`}
            cx={toX(m)}
            cy={H - 10}
            r={1}
            fill="#9ca3af"
          />
        ))}

        {/* Timeline labels */}
        <text x={toX(0)} y={H - 2} textAnchor="start" fontSize={11} fill="#6b7280" fontWeight="500">
          0'
        </text>
        <text x={htX} y={H - 2} textAnchor="middle" fontSize={11} fill="#6b7280" fontWeight="500">
          45'
        </text>
        <text x={toX(90)} y={H - 2} textAnchor="end" fontSize={11} fill="#6b7280" fontWeight="500">
          90'
        </text>
      </svg>

      {/* Legend footer */}
      <div className="flex justify-between items-center px-3 py-1.5 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
          <span className="text-[10px] text-gray-600 font-medium truncate max-w-[100px]">{homeName}</span>
        </div>
        <span className="text-[9px] text-gray-400 font-medium">{currentMinute}'</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 font-medium truncate max-w-[100px]">{awayName}</span>
          <span className="w-2.5 h-2.5 rounded-sm bg-green-500" />
        </div>
      </div>
    </div>
  );
};

export default MomentumChart;
