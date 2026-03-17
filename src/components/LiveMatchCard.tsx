import { MatchData } from '@/types/match';
import { Trophy, Activity, Zap } from 'lucide-react';

interface Props {
  match: MatchData;
}

const LiveMatchCard = ({ match }: Props) => {
  const homePressure = match.liveStats?.pressureIndex?.[0] ?? 0;
  const awayPressure = match.liveStats?.pressureIndex?.[1] ?? 0;

  const totalPressure = homePressure + awayPressure || 1;

  const homeCorners = match.liveStats?.corners?.[0] ?? 0;
  const awayCorners = match.liveStats?.corners?.[1] ?? 0;

  const getPressureColor = (val: number) => {
    if (val > 70) return 'text-red-500';
    if (val > 40) return 'text-orange-400';
    return 'text-green-400';
  };

  return (
    <div className="bg-card rounded-2xl border border-primary/30 overflow-hidden animate-pulse-subtle border-l-4 border-l-primary">
      
      {/* Header Live */}
      <div className="bg-secondary/50 px-4 py-2 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-muted-foreground">
            {match.league || "Liga"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-red-500/10 px-2 py-0.5 rounded-full">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span className="text-[10px] font-bold text-red-500 uppercase">
            {match.status || "LIVE"} {match.time || ""}
          </span>
        </div>
      </div>

      {/* Times */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-6">
        <div className="text-right">
          <h2 className="font-display text-lg sm:text-2xl uppercase">
            {match.homeTeam}
          </h2>
        </div>

        <div className="bg-secondary rounded-lg px-4 py-2 border border-border">
          <span className="font-display text-3xl sm:text-4xl text-primary">
            {match.liveScore?.home ?? 0} : {match.liveScore?.away ?? 0}
          </span>
        </div>

        <div className="text-left">
          <h2 className="font-display text-lg sm:text-2xl uppercase">
            {match.awayTeam}
          </h2>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 pb-4 grid grid-cols-2 gap-3">

        {/* Pressão */}
        <div className="bg-secondary/30 p-3 rounded-xl border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-[10px] uppercase font-bold text-muted-foreground">
              Pressão (AP/10min)
            </span>
          </div>

          <div className="flex justify-between items-end">
            <span className={`text-lg font-display ${getPressureColor(homePressure)}`}>
              {homePressure}
            </span>

            <div className="flex-1 mx-2 h-1.5 bg-border rounded-full overflow-hidden flex">
              <div
                className="bg-primary h-full"
                style={{ width: `${(homePressure / totalPressure) * 100}%` }}
              />
            </div>

            <span className={`text-lg font-display ${getPressureColor(awayPressure)}`}>
              {awayPressure}
            </span>
          </div>
        </div>

        {/* Escanteios */}
        <div className="bg-secondary/30 p-3 rounded-xl border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] uppercase font-bold text-muted-foreground">
              Escanteios Real
            </span>
          </div>

          <div className="flex justify-between items-center text-xl font-display">
            <span>{homeCorners}</span>
            <span className="text-xs text-muted-foreground">CORNER</span>
            <span>{awayCorners}</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LiveMatchCard;
