import { useEffect, useRef, useState } from 'react';

type EventKind = 'goal' | 'shot' | 'corner' | 'attack';
type Side = 'home' | 'away';

interface LiveFieldAnimationProps {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  status?: string;
  /** Snapshot atual de stats — qualquer mudança dispara animações */
  stats?: {
    shotsOnGoalHome?: number;
    shotsOnGoalAway?: number;
    cornersHome?: number;
    cornersAway?: number;
    dangerousAttacksHome?: number;
    dangerousAttacksAway?: number;
  };
}

interface ActiveEvent {
  id: number;
  kind: EventKind;
  side: Side;
  ts: number;
}

/**
 * Campo de futebol em perspectiva isométrica (estilo AiScore).
 * A bola anima conforme eventos reais (chute, gol, escanteio, ataque perigoso).
 */
const LiveFieldAnimation = ({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  minute,
  status = 'LIVE',
  stats,
}: LiveFieldAnimationProps) => {
  const prevStats = useRef(stats);
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [flash, setFlash] = useState<Side | null>(null);
  const evCounter = useRef(0);

  // Detecta mudanças nas estatísticas e dispara eventos
  useEffect(() => {
    if (!stats) return;
    const prev = prevStats.current ?? {};
    const next = stats;

    const events: { kind: EventKind; side: Side }[] = [];

    // Gols (placar)
    // (gols já refletem em homeScore/awayScore — animação separada abaixo)

    // Chutes ao gol
    if ((next.shotsOnGoalHome ?? 0) > (prev.shotsOnGoalHome ?? 0))
      events.push({ kind: 'shot', side: 'home' });
    if ((next.shotsOnGoalAway ?? 0) > (prev.shotsOnGoalAway ?? 0))
      events.push({ kind: 'shot', side: 'away' });

    // Escanteios
    if ((next.cornersHome ?? 0) > (prev.cornersHome ?? 0))
      events.push({ kind: 'corner', side: 'home' });
    if ((next.cornersAway ?? 0) > (prev.cornersAway ?? 0))
      events.push({ kind: 'corner', side: 'away' });

    // Ataque perigoso (variação ≥ 3)
    if ((next.dangerousAttacksHome ?? 0) - (prev.dangerousAttacksHome ?? 0) >= 3)
      events.push({ kind: 'attack', side: 'home' });
    if ((next.dangerousAttacksAway ?? 0) - (prev.dangerousAttacksAway ?? 0) >= 3)
      events.push({ kind: 'attack', side: 'away' });

    // Dispara o evento mais "alto" (gol > chute > escanteio > ataque já foi tratado em score)
    if (events.length > 0) {
      const ranking: EventKind[] = ['shot', 'corner', 'attack'];
      const top = events.sort(
        (a, b) => ranking.indexOf(a.kind) - ranking.indexOf(b.kind),
      )[0];
      evCounter.current += 1;
      setEvent({ id: evCounter.current, kind: top.kind, side: top.side, ts: Date.now() });
    }

    prevStats.current = stats;
  }, [stats]);

  // Detecta gol via mudança de placar
  const prevScore = useRef({ home: homeScore, away: awayScore });
  useEffect(() => {
    if (homeScore > prevScore.current.home) {
      evCounter.current += 1;
      setEvent({ id: evCounter.current, kind: 'goal', side: 'home', ts: Date.now() });
      setFlash('home');
      setTimeout(() => setFlash(null), 1500);
    }
    if (awayScore > prevScore.current.away) {
      evCounter.current += 1;
      setEvent({ id: evCounter.current, kind: 'goal', side: 'away', ts: Date.now() });
      setFlash('away');
      setTimeout(() => setFlash(null), 1500);
    }
    prevScore.current = { home: homeScore, away: awayScore };
  }, [homeScore, awayScore]);

  // Limpa o evento depois da animação
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(() => setEvent(null), 2200);
    return () => clearTimeout(t);
  }, [event]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-[hsl(var(--secondary))]">
      {/* Flash de gol */}
      {flash && (
        <div
          className={`pointer-events-none absolute inset-0 z-20 animate-pulse ${
            flash === 'home' ? 'bg-primary/30' : 'bg-destructive/30'
          }`}
        />
      )}

      {/* Tag LIVE */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-red-500/20 backdrop-blur-sm px-2.5 py-1 rounded-full border border-red-500/40">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
        <span className="text-[10px] font-bold text-red-100 uppercase tracking-wider">
          {status} {minute}'
        </span>
      </div>

      {/* Etiqueta de evento */}
      {event && (
        <div className="absolute top-3 right-3 z-10 animate-fade-in">
          <div className="bg-primary text-primary-foreground text-[10px] font-bold uppercase px-2.5 py-1 rounded-full tracking-wider shadow-lg">
            {event.kind === 'goal' && '⚽ GOL!'}
            {event.kind === 'shot' && '🎯 Chute ao gol'}
            {event.kind === 'corner' && '🚩 Escanteio'}
            {event.kind === 'attack' && '⚡ Ataque perigoso'}
          </div>
        </div>
      )}

      {/* SVG do campo isométrico */}
      <svg
        viewBox="0 0 720 360"
        className="w-full h-auto block"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a8f3a" />
            <stop offset="100%" stopColor="#2d6f2d" />
          </linearGradient>
          <linearGradient id="grassStripe" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4aa14a" />
            <stop offset="100%" stopColor="#358035" />
          </linearGradient>
          <pattern id="stripes" x="0" y="0" width="80" height="360" patternUnits="userSpaceOnUse">
            <rect width="40" height="360" fill="url(#grass)" />
            <rect x="40" width="40" height="360" fill="url(#grassStripe)" />
          </pattern>
        </defs>

        {/* Gramado base */}
        <rect width="720" height="360" fill="url(#stripes)" />

        {/* Trapézio em perspectiva (sutil) */}
        <polygon
          points="0,360 720,360 640,40 80,40"
          fill="url(#grass)"
          opacity="0.25"
        />

        {/* Linhas do campo (perspectiva levemente isométrica) */}
        <g
          stroke="white"
          strokeWidth="2.5"
          fill="none"
          opacity="0.85"
          strokeLinecap="round"
        >
          {/* Linha lateral superior e inferior */}
          <line x1="60" y1="50" x2="660" y2="50" />
          <line x1="20" y1="340" x2="700" y2="340" />
          {/* Laterais */}
          <line x1="60" y1="50" x2="20" y2="340" />
          <line x1="660" y1="50" x2="700" y2="340" />
          {/* Linha do meio */}
          <line x1="360" y1="50" x2="360" y2="340" />
          {/* Círculo central (elipse para perspectiva) */}
          <ellipse cx="360" cy="195" rx="55" ry="32" />
          <circle cx="360" cy="195" r="3" fill="white" />

          {/* Grande área esquerda */}
          <polygon points="60,130 180,130 165,260 30,260" />
          {/* Pequena área esquerda */}
          <polygon points="60,170 110,170 100,225 45,225" />
          {/* Marca do pênalti esquerdo */}
          <circle cx="125" cy="195" r="2.5" fill="white" />

          {/* Grande área direita */}
          <polygon points="540,130 660,130 690,260 555,260" />
          {/* Pequena área direita */}
          <polygon points="610,170 660,170 675,225 620,225" />
          {/* Marca do pênalti direito */}
          <circle cx="595" cy="195" r="2.5" fill="white" />
        </g>

        {/* Gol esquerdo */}
        <g>
          <rect
            x="48"
            y="170"
            width="14"
            height="52"
            fill="rgba(255,255,255,0.15)"
            stroke="white"
            strokeWidth="2"
          />
          {/* Rede */}
          <g stroke="white" strokeWidth="0.5" opacity="0.6">
            <line x1="48" y1="178" x2="62" y2="178" />
            <line x1="48" y1="186" x2="62" y2="186" />
            <line x1="48" y1="194" x2="62" y2="194" />
            <line x1="48" y1="202" x2="62" y2="202" />
            <line x1="48" y1="210" x2="62" y2="210" />
            <line x1="51" y1="170" x2="51" y2="222" />
            <line x1="55" y1="170" x2="55" y2="222" />
            <line x1="59" y1="170" x2="59" y2="222" />
          </g>
        </g>

        {/* Gol direito */}
        <g>
          <rect
            x="658"
            y="170"
            width="14"
            height="52"
            fill="rgba(255,255,255,0.15)"
            stroke="white"
            strokeWidth="2"
          />
          <g stroke="white" strokeWidth="0.5" opacity="0.6">
            <line x1="658" y1="178" x2="672" y2="178" />
            <line x1="658" y1="186" x2="672" y2="186" />
            <line x1="658" y1="194" x2="672" y2="194" />
            <line x1="658" y1="202" x2="672" y2="202" />
            <line x1="658" y1="210" x2="672" y2="210" />
            <line x1="661" y1="170" x2="661" y2="222" />
            <line x1="665" y1="170" x2="665" y2="222" />
            <line x1="669" y1="170" x2="669" y2="222" />
          </g>
        </g>

        {/* Bandeirinhas de escanteio */}
        <g>
          <line x1="60" y1="50" x2="60" y2="38" stroke="white" strokeWidth="1.5" />
          <polygon points="60,38 70,42 60,46" fill="hsl(var(--primary))" />
          <line x1="660" y1="50" x2="660" y2="38" stroke="white" strokeWidth="1.5" />
          <polygon points="660,38 670,42 660,46" fill="hsl(var(--primary))" />
          <line x1="20" y1="340" x2="20" y2="328" stroke="white" strokeWidth="1.5" />
          <polygon points="20,328 30,332 20,336" fill="hsl(var(--primary))" />
          <line x1="700" y1="340" x2="700" y2="328" stroke="white" strokeWidth="1.5" />
          <polygon points="700,328 710,332 700,336" fill="hsl(var(--primary))" />
        </g>

        {/* Trajetória pontilhada (mostra para onde a bola vai durante o evento) */}
        {event && event.kind !== 'attack' && (
          <BallTrajectory key={event.id} kind={event.kind} side={event.side} />
        )}

        {/* Bola */}
        <Ball event={event} />
      </svg>

      {/* Rodapé com placar (estilo AiScore) */}
      <div className="bg-[hsl(var(--background))]/95 backdrop-blur-sm border-t border-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded bg-red-500/20 border border-red-500/40 flex items-center justify-center text-xs">
            🏠
          </div>
          <span className="font-display text-sm sm:text-base uppercase truncate">
            {homeTeam}
          </span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[hsl(var(--secondary))] border border-border">
          <span className="font-display text-xl text-primary">{homeScore}</span>
          <span className="text-muted-foreground">:</span>
          <span className="font-display text-xl text-primary">{awayScore}</span>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <span className="font-display text-sm sm:text-base uppercase truncate text-right">
            {awayTeam}
          </span>
          <div className="w-7 h-7 rounded bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs">
            🏟️
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Bola animada ─── */
const Ball = ({ event }: { event: ActiveEvent | null }) => {
  // Posições no SVG (viewBox 720x360)
  const center = { cx: 360, cy: 195 };
  const goalLeft = { cx: 60, cy: 195 };
  const goalRight = { cx: 658, cy: 195 };
  const cornerHome = { cx: 60, cy: 50 };  // canto esquerdo
  const cornerAway = { cx: 660, cy: 50 }; // canto direito

  let from = center;
  let to = center;
  let dur = '0s';

  if (event) {
    if (event.kind === 'goal' || event.kind === 'shot') {
      // home ataca a direita; away ataca a esquerda
      from = center;
      to = event.side === 'home' ? goalRight : goalLeft;
      dur = '1.6s';
    } else if (event.kind === 'corner') {
      from = center;
      to = event.side === 'home' ? cornerAway : cornerHome;
      dur = '1.4s';
    } else if (event.kind === 'attack') {
      from = center;
      to =
        event.side === 'home'
          ? { cx: 540, cy: 195 }
          : { cx: 180, cy: 195 };
      dur = '1.2s';
    }
  }

  return (
    <g key={event?.id ?? 'idle'}>
      <circle
        cx={from.cx}
        cy={from.cy}
        r="7"
        fill="white"
        stroke="#222"
        strokeWidth="1.2"
        filter="drop-shadow(0 2px 3px rgba(0,0,0,0.5))"
      >
        {event && (
          <>
            <animate
              attributeName="cx"
              from={from.cx}
              to={to.cx}
              dur={dur}
              fill="freeze"
              calcMode="spline"
              keySplines="0.25 0.1 0.25 1"
            />
            <animate
              attributeName="cy"
              from={from.cy}
              to={to.cy}
              dur={dur}
              fill="freeze"
              calcMode="spline"
              keySplines="0.25 0.1 0.25 1"
            />
            <animate
              attributeName="r"
              values="7;8.5;7"
              dur={dur}
              repeatCount="1"
            />
          </>
        )}
      </circle>
      {/* Detalhe pentagonal (pequeno) */}
      <circle
        cx={from.cx}
        cy={from.cy}
        r="2"
        fill="#222"
        opacity="0.8"
      >
        {event && (
          <>
            <animate attributeName="cx" from={from.cx} to={to.cx} dur={dur} fill="freeze" />
            <animate attributeName="cy" from={from.cy} to={to.cy} dur={dur} fill="freeze" />
          </>
        )}
      </circle>
    </g>
  );
};

/* ─── Trajetória pontilhada ─── */
const BallTrajectory = ({ kind, side }: { kind: EventKind; side: Side }) => {
  const center = { x: 360, y: 195 };
  let target = { x: 360, y: 195 };

  if (kind === 'goal' || kind === 'shot') {
    target = side === 'home' ? { x: 658, y: 195 } : { x: 60, y: 195 };
  } else if (kind === 'corner') {
    target = side === 'home' ? { x: 660, y: 50 } : { x: 60, y: 50 };
  }

  // Curva suave (controle de Bézier elevado para parecer um chute em arco)
  const ctrlY = Math.min(center.y, target.y) - 90;
  const ctrlX = (center.x + target.x) / 2;

  const path = `M ${center.x} ${center.y} Q ${ctrlX} ${ctrlY} ${target.x} ${target.y}`;

  return (
    <path
      d={path}
      stroke="white"
      strokeWidth="2"
      strokeDasharray="6 6"
      fill="none"
      opacity="0.9"
      className="animate-fade-in"
    />
  );
};

export default LiveFieldAnimation;
