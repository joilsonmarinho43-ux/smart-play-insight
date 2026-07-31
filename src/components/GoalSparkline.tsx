import { useId } from 'react';
import { AreaChart, Area, ReferenceLine } from 'recharts';

interface Props {
  data: number[];
  color: string;
  label: string;
}

const W = 100;
const H = 32;

const GoalSparkline = ({ data, color, label }: Props) => {
  // useId precisa ser chamado antes de qualquer return condicional (regra dos hooks)
  const rawId = useId();
  const gradId = `grad${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  if (!data || data.length < 2) return null;

  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const chartData = data.map((val, i) => ({ game: i + 1, goals: val }));

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
      {/* Dimensões fixas: evita o warning do recharts quando o card está recolhido/oculto */}
      <div style={{ width: W, height: H }}>
        <AreaChart width={W} height={H} data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <ReferenceLine y={avg} stroke={color} strokeOpacity={0.3} strokeDasharray="2 2" />
          <Area
            type="monotone"
            dataKey="goals"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={{ r: 2, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </div>
      <div className="flex gap-1">
        {data.map((g, i) => (
          <span key={i} className="text-[8px] tabular-nums text-muted-foreground font-medium">{g}</span>
        ))}
      </div>
    </div>
  );
};

export default GoalSparkline;
