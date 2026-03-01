interface MetricRowProps {
  label: string;
  homeValue: number;
  awayValue: number;
  format?: 'decimal' | 'integer' | 'percent';
  index: number;
}

const MetricRow = ({ label, homeValue, awayValue, format = 'integer', index }: MetricRowProps) => {
  const formatValue = (v: number) => {
    if (format === 'decimal') return v.toFixed(2);
    if (format === 'percent') return `${v}%`;
    return String(v);
  };

  const homeWins = homeValue > awayValue;
  const awayWins = awayValue > homeValue;
  const isDraw = homeValue === awayValue;

  return (
    <div
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 py-2.5 px-2 sm:px-4 rounded-lg hover:bg-secondary/50 transition-colors"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Home value */}
      <div className="flex justify-end">
        <span
          className={`inline-flex items-center justify-center min-w-[3rem] sm:min-w-[4rem] px-3 py-1.5 rounded-full text-sm sm:text-base font-semibold transition-all ${
            homeWins
              ? 'pill-orange glow-orange'
              : isDraw
              ? 'pill-neutral'
              : 'pill-neutral'
          }`}
        >
          {formatValue(homeValue)}
        </span>
      </div>

      {/* Metric name */}
      <div className="text-center min-w-[100px] sm:min-w-[160px]">
        <span className="text-xs sm:text-sm text-muted-foreground font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>

      {/* Away value */}
      <div className="flex justify-start">
        <span
          className={`inline-flex items-center justify-center min-w-[3rem] sm:min-w-[4rem] px-3 py-1.5 rounded-full text-sm sm:text-base font-semibold transition-all ${
            awayWins
              ? 'pill-green glow-green'
              : isDraw
              ? 'pill-neutral'
              : 'pill-neutral'
          }`}
        >
          {formatValue(awayValue)}
        </span>
      </div>
    </div>
  );
};

export default MetricRow;
