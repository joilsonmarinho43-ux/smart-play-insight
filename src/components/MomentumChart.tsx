/**
 * MOMENTUM DE PRESSÃO — Estilo SofaScore Pressure Chart (pixel-perfect)
 * Gráfico de área: azul escuro para cima (home), verde para baixo (away).
 * A pressão preenche agressivamente a área, com picos e vales dinâmicos.
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
 * Interpola snapshots para criar pontos a cada minuto (suavização)
 * e gera a curva de pressão normalizada.
 * Retorna valores de -1 (100% away) a +1 (100% home).
 */
function buildPressureCurve(history: PISnapshot[], currentMinute: number): { minute: number; value: number }[] {
  if (history.length === 0) return [];

  // Ordena por minuto
  const sorted = [...history].sort((a, b) => a.minute - b.minute);

  // Cria ponto para cada minuto, interpolando entre snapshots
  const firstMin = Math.max(0, sorted[0].minute);
  const lastMin = Math.min(currentMinute, 90);
  const points: { minute: number; value: number }[] = [];

  for (let m = firstMin; m <= lastMin; m++) {
    // Encontra os snapshots mais próximos antes e depois
    let before = sorted[0];
    let after = sorted[sorted.length - 1];

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].minute <= m) before = sorted[i];
      if (sorted[i].minute >= m && (after.minute < m || sorted[i].minute < after.minute)) {
        after = sorted[i];
      }
    }

    let homePI: number, awayPI: number;

    if (before.minute === after.minute || before === after) {
      homePI = before.homePI;
      awayPI = before.awayPI;
    } else {
      // Interpolação linear
      const t = (m - before.minute) / (after.minute - before.minute);
      homePI = before.homePI + (after.homePI - before.homePI) * t;
      awayPI = before.awayPI + (after.awayPI - before.awayPI) * t;
    }

    const total = homePI + awayPI;
    if (total === 0) {
      points.push({ minute: m, value: 0 });
    } else {
      // Normaliza para -1 a +1 e amplifica para preencher mais o gráfico
      const raw = (homePI - awayPI) / total;
      // Amplifica o sinal para parecer mais dramático (como SofaScore)
      const amplified = Math.sign(raw) * Math.pow(Math.abs(raw), 0.6);
      points.push({ minute: m, value: Math.max(-1, Math.min(1, amplified * 1.5)) });
    }
  }

  return points;
}

const MomentumChart = ({ history, homeName, awayName, currentMinute }: Props) => {
  const points = useMemo(() => buildPressureCurve(history, currentMinute), [history, currentMinute]);

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-[#f8f9fa] p-6 text-center">
        <span className="text-[11px] text-gray-400 font-medium">
          Aguardando dados de pressão...
        </span>
      </div>
    );
  }

  // ── Layout ──
  const W = 420;
  const H = 180;
  const padL = 4;
  const padR = 4;
  const padT = 6;
  const padB = 24; // timeline
  const chartH = H - padT - padB;
  const plotW = W - padL - padR;
  const midY = padT + chartH / 2;

  // ── Mapping ──
  const toX = (min: number) => padL + (min / 90) * plotW;
  const toY = (v: number) => midY - v * (chartH / 2);

  const lastPt = points[points.length - 1];
  const firstPt = points[0];

  // ── Build SVG path (starts and ends at midY) ──
  const areaPath =
    `M${toX(firstPt.minute).toFixed(1)},${midY} ` +
    points.map((p) => `L${toX(p.minute).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
    ` L${toX(lastPt.minute).toFixed(1)},${midY} Z`;

  // ── Timeline dots ──
  const dots: number[] = [];
  for (let m = 0; m <= 90; m += 3) dots.push(m);

  const htX = toX(45);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 bg-[#f8f9fa] shadow-sm">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block"
      >
        {/* ── Clip paths ── */}
        <defs>
          <clipPath id="pressClipUp">
            <rect x={0} y={padT} width={W} height={chartH / 2} />
          </clipPath>
          <clipPath id="pressClipDn">
            <rect x={0} y={midY} width={W} height={chartH / 2} />
          </clipPath>
        </defs>

        {/* ── Background zones ── */}
        <rect x={padL} y={padT} width={plotW} height={chartH / 2} fill="#d6e4f7" />
        <rect x={padL} y={midY} width={plotW} height={chartH / 2} fill="#d4f0d8" />

        {/* ── Center line ── */}
        <line x1={padL} x2={padL + plotW} y1={midY} y2={midY} stroke="#c8cdd3" strokeWidth={0.8} />

        {/* ── HT vertical dotted line ── */}
        <line
          x1={htX} x2={htX}
          y1={padT} y2={padT + chartH}
          stroke="#b0b8c1"
          strokeWidth={0.8}
          strokeDasharray="2 3"
        />

        {/* ── Home pressure fill (BLUE — clipped upper half) ── */}
        <path
          d={areaPath}
          fill="#1a56db"
          opacity={0.92}
          clipPath="url(#pressClipUp)"
        />

        {/* ── Away pressure fill (GREEN — clipped lower half) ── */}
        <path
          d={areaPath}
          fill="#16a34a"
          opacity={0.88}
          clipPath="url(#pressClipDn)"
        />

        {/* ── Timeline dots ── */}
        {dots.map((m) => (
          <circle key={m} cx={toX(m)} cy={H - 11} r={1.2} fill="#adb5bd" />
        ))}

        {/* ── Timeline labels ── */}
        <text x={toX(0) + 2} y={H - 2} textAnchor="start" fontSize={12} fill="#6b7280" fontWeight="500" fontFamily="system-ui, sans-serif">0'</text>
        <text x={htX} y={H - 2} textAnchor="middle" fontSize={12} fill="#6b7280" fontWeight="500" fontFamily="system-ui, sans-serif">45'</text>
        <text x={toX(90) - 2} y={H - 2} textAnchor="end" fontSize={12} fill="#6b7280" fontWeight="500" fontFamily="system-ui, sans-serif">90'</text>
      </svg>

      {/* ── Legend ── */}
      <div className="flex justify-between items-center px-3 py-1.5 bg-[#f0f2f5]">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#1a56db' }} />
          <span className="text-[11px] text-gray-700 font-semibold truncate max-w-[110px]">{homeName}</span>
        </div>
        <span className="text-[10px] text-gray-400 font-medium tabular-nums">{currentMinute}'</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-700 font-semibold truncate max-w-[110px]">{awayName}</span>
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#16a34a' }} />
        </div>
      </div>
    </div>
  );
};

export default MomentumChart;
