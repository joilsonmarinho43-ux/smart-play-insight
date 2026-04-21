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

/** PRNG determinístico — sempre gera os mesmos "micro-ruídos" para os mesmos dados */
function seededRng(seed: number) {
  let t = (seed * 9301 + 49297) >>> 0;
  return () => {
    t = (t * 9301 + 49297) % 233280;
    return t / 233280;
  };
}

/**
 * Gera curva de pressão com micro-oscilações realistas (estilo SofaScore).
 * Cada ponto de snapshot gera vários "sub-pontos" com variação controlada
 * para criar o efeito de picos agressivos.
 */
function buildPressureCurve(history: PISnapshot[], currentMinute: number): { minute: number; value: number }[] {
  if (history.length === 0) return [];

  const sorted = [...history].sort((a, b) => a.minute - b.minute);
  const out: { minute: number; value: number }[] = [];
  const rng = seededRng(sorted.length * 7 + (sorted[0]?.homePI || 0) * 100);

  // Gera pontos para cada minuto do 0 ao minuto atual
  const endMin = Math.min(currentMinute, 90);
  const startMin = 0;

  for (let m = startMin; m <= endMin; m++) {
    // Encontra snapshots vizinhos para interpolação
    let before = sorted[0];
    let after = sorted[sorted.length - 1];

    for (const s of sorted) {
      if (s.minute <= m) before = s;
    }
    for (const s of sorted) {
      if (s.minute >= m) { after = s; break; }
    }

    let homePI: number, awayPI: number;
    if (before.minute === after.minute) {
      homePI = before.homePI;
      awayPI = before.awayPI;
    } else {
      const t = Math.max(0, Math.min(1, (m - before.minute) / (after.minute - before.minute)));
      homePI = before.homePI + (after.homePI - before.homePI) * t;
      awayPI = before.awayPI + (after.awayPI - before.awayPI) * t;
    }

    const total = homePI + awayPI;
    if (total === 0) {
      out.push({ minute: m, value: 0 });
      continue;
    }

    // Pressão base normalizada (-1 a +1)
    const base = (homePI - awayPI) / total;

    // Adiciona micro-variação para criar picos realistas (como SofaScore)
    // A variação é mais forte quando a diferença é menor (jogo equilibrado = mais oscilação)
    const volatility = 0.3 + (1 - Math.abs(base)) * 0.5;
    const noise = (rng() - 0.5) * volatility;

    // Ocasionalmente gera um spike forte (mudança brusca de momentum)
    const spike = rng() < 0.12 ? (rng() - 0.5) * 1.2 : 0;

    let value = base + noise + spike;
    // Clamp entre -1 e 1
    value = Math.max(-1, Math.min(1, value));

    out.push({ minute: m, value });
  }

  return out;
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
  const H = 170;
  const padL = 4;
  const padR = 4;
  const padT = 4;
  const padB = 22;
  const chartH = H - padT - padB;
  const plotW = W - padL - padR;
  const midY = padT + chartH / 2;

  const toX = (min: number) => padL + (min / 90) * plotW;
  const toY = (v: number) => midY - v * (chartH / 2);

  const lastPt = points[points.length - 1];
  const firstPt = points[0];

  // ── SVG area path ──
  const areaPath =
    `M${toX(firstPt.minute).toFixed(1)},${midY} ` +
    points.map((p) => `L${toX(p.minute).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
    ` L${toX(lastPt.minute).toFixed(1)},${midY} Z`;

  // ── Timeline dots ──
  const dots: number[] = [];
  for (let m = 0; m <= 90; m += 3) dots.push(m);

  const htX = toX(45);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 bg-[#f5f7fa] shadow-sm">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block"
      >
        <defs>
          <clipPath id="pressClipUp">
            <rect x={0} y={padT} width={W} height={chartH / 2} />
          </clipPath>
          <clipPath id="pressClipDn">
            <rect x={0} y={midY} width={W} height={chartH / 2} />
          </clipPath>
        </defs>

        {/* ── Background zones ── */}
        <rect x={padL} y={padT} width={plotW} height={chartH / 2} fill="#dae5f5" />
        <rect x={padL} y={midY} width={plotW} height={chartH / 2} fill="#d5f0d9" />

        {/* ── Center line ── */}
        <line x1={padL} x2={padL + plotW} y1={midY} y2={midY} stroke="#c0c8d0" strokeWidth={0.6} />

        {/* ── HT vertical dotted line ── */}
        <line
          x1={htX} x2={htX}
          y1={padT} y2={padT + chartH}
          stroke="#a8b2bc"
          strokeWidth={0.7}
          strokeDasharray="2 3"
        />

        {/* ── Home pressure fill (dark blue) ── */}
        <path d={areaPath} fill="#1e40af" opacity={0.88} clipPath="url(#pressClipUp)" />

        {/* ── Away pressure fill (green) ── */}
        <path d={areaPath} fill="#15803d" opacity={0.85} clipPath="url(#pressClipDn)" />

        {/* ── Timeline dots ── */}
        {dots.map((m) => (
          <circle key={m} cx={toX(m)} cy={H - 10} r={1.1} fill="#b0b8c4" />
        ))}

        {/* ── Timeline labels ── */}
        <text x={toX(0) + 2} y={H - 1} textAnchor="start" fontSize={12} fill="#6b7280" fontWeight="500" fontFamily="system-ui, sans-serif">0'</text>
        <text x={htX} y={H - 1} textAnchor="middle" fontSize={12} fill="#6b7280" fontWeight="500" fontFamily="system-ui, sans-serif">45'</text>
        <text x={toX(90) - 2} y={H - 1} textAnchor="end" fontSize={12} fill="#6b7280" fontWeight="500" fontFamily="system-ui, sans-serif">90'</text>
      </svg>

      {/* ── Legend ── */}
      <div className="flex justify-between items-center px-3 py-1.5 bg-[#eef1f5]">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#1e40af' }} />
          <span className="text-[11px] text-gray-700 font-semibold truncate max-w-[110px]">{homeName}</span>
        </div>
        <span className="text-[10px] text-gray-400 font-medium tabular-nums">{currentMinute}'</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-700 font-semibold truncate max-w-[110px]">{awayName}</span>
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#15803d' }} />
        </div>
      </div>
    </div>
  );
};

export default MomentumChart;
