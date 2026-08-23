import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMultiDayMatches } from '@/services/footballApi';
import { localizeTeamName } from '@/lib/teamI18n';
import { isPremiumLeague } from '@/lib/premiumLeagues';
import { APP_TIMEZONE, formatTimePara, getTodayInPara } from '@/lib/timezone';
import { buildCorrectScore, pct, type CorrectScoreRead } from '@/lib/correctScoreEngine';
import { useScannerEnrichment } from '@/hooks/useScannerEnrichment';
import { Loader2, Target, Crown, TrendingUp, ShieldCheck, AlertTriangle } from 'lucide-react';
import bgPattern from '@/assets/bg-circuit-pattern.jpg';

function paraDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function getMatchIso(match: any): string | null {
  return match?.fixture?.date || (typeof match?.time === 'string' && match.time.includes('T') ? match.time : null);
}

const STARTED = new Set([
  '1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'FT', 'AET', 'PEN', 'AWD', 'WO', 'SUSP', 'INT',
  'IN_PLAY', 'PAUSED', 'FINISHED', 'AWARDED',
]);

function isUpcoming(match: any): boolean {
  const status = String(match?.fixture?.status?.short ?? match?.status?.short ?? match?.status ?? '').toUpperCase();
  if (STARTED.has(status)) return false;
  const iso = getMatchIso(match);
  if (iso) {
    const ts = new Date(iso).getTime();
    if (!Number.isNaN(ts) && ts < Date.now() - 10 * 60 * 1000) return false;
  }
  return true;
}

const labelColor: Record<CorrectScoreRead['label'], string> = {
  ALTA: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  MÉDIA: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  BAIXA: 'text-gray-400 border-white/15 bg-white/5',
};

const CorrectScore = () => {
  const [selectedDay, setSelectedDay] = useState(0);
  const [onlyPremium, setOnlyPremium] = useState(false);
  const [onlyReal, setOnlyReal] = useState(true);

  const todayKey = getTodayInPara();
  const { data: rawMatches, isFetching } = useQuery({
    queryKey: ['matches-multiday', todayKey],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 60 * 6,
    gcTime: 1000 * 60 * 60 * 24,
  });

  const dayOptions = useMemo(() => {
    const base = new Date(`${getTodayInPara()}T12:00:00-03:00`);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return {
        index: i,
        date: paraDateString(d),
        label: i === 0 ? 'Hoje' : i === 1 ? 'Amanhã'
          : new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TIMEZONE, weekday: 'short', day: '2-digit' }).format(d),
      };
    });
  }, []);

  // 1) Filtra por dia ANTES de enriquecer (economiza chamadas à API)
  const dayMatches = useMemo(() => {
    const selectedDate = dayOptions[selectedDay]?.date;
    return (rawMatches || [])
      .filter(isUpcoming)
      .map((m: any) => ({
        ...m,
        homeTeam: m.homeTeam || m.teams?.home?.name || '',
        awayTeam: m.awayTeam || m.teams?.away?.name || '',
        __iso: getMatchIso(m),
      }))
      .filter((m: any) => {
        const d = m.__iso ? paraDateString(new Date(m.__iso)) : m.date || '';
        const league = m.league?.name || m.league || '';
        return (!selectedDate || d === selectedDate) && (!onlyPremium || isPremiumLeague(league));
      })
      // Ligas de elite primeiro: garantem histórico real dentro do limite de enriquecimento
      .sort((a: any, b: any) => {
        const pa = isPremiumLeague(a.league?.name || a.league || '') ? 0 : 1;
        const pb = isPremiumLeague(b.league?.name || b.league || '') ? 0 : 1;
        return pa - pb;
      });
  }, [rawMatches, dayOptions, selectedDay, onlyPremium]);


  // 2) Enriquece com os últimos jogos reais (mesma fonte do Scanner PRO)
  const { matches: enriched, isEnriching } = useScannerEnrichment(dayMatches as any);

  const rows = useMemo(() => {
    return (enriched || [])
      .map((m: any) => {
        const iso = m.__iso || getMatchIso(m);
        const league = m.league?.name || m.league || '';
        return {
          id: String(m.id ?? m.fixture?.id ?? `${m.homeTeam}-${m.awayTeam}`),
          date: iso ? paraDateString(new Date(iso)) : m.date || '',
          time: iso ? formatTimePara(iso) : m.time || '',
          league,
          premium: isPremiumLeague(league),
          homeTeam: localizeTeamName(m.homeTeam) || 'Casa',
          awayTeam: localizeTeamName(m.awayTeam) || 'Fora',
          read: buildCorrectScore(m),
        };
      })
      .filter((r) => (!onlyReal || r.read.hasRealData))
      .sort((a, b) => b.read.confidence - a.read.confidence || (a.time || '').localeCompare(b.time || ''));
  }, [enriched, onlyReal]);


  return (
    <div className="min-h-screen text-white pb-10 font-sans relative">
      <div
        className="fixed inset-0 z-0"
        style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="fixed inset-0 z-0 bg-black/50" />

      <main className="container max-w-3xl lg:max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
        <header className="pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Target className="h-6 w-6 text-orange-500" />
            </div>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl tracking-wide uppercase text-orange-400">
                Placar Exato
              </h1>
              <p className="text-xs text-gray-400">
                Poisson bivariado + ajuste Dixon-Coles sobre médias reais das equipes
              </p>
            </div>
          </div>
        </header>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 pb-4">
          {dayOptions.map((d) => (
            <button
              key={d.index}
              onClick={() => setSelectedDay(d.index)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                selectedDay === d.index
                  ? 'bg-orange-500/15 border-orange-500/50 text-orange-400'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
              }`}
            >
              {d.label}
            </button>
          ))}
          <button
            onClick={() => setOnlyReal((v) => !v)}
            className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors ${
              onlyReal
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400'
                : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Só com dados reais
          </button>
          <button
            onClick={() => setOnlyPremium((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors ${
              onlyPremium
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-400'
                : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            <Crown className="h-3.5 w-3.5" /> Elite
          </button>
        </div>

        {(isFetching || isEnriching) && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
            <p className="text-xs text-gray-400">Carregando histórico real das equipes…</p>
          </div>
        )}

        {!isFetching && !isEnriching && rows.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-black/40 p-8 text-center text-sm text-gray-400">
            {onlyReal
              ? 'Nenhum jogo com histórico real confirmado para esta data. Desative "Só com dados reais" para ver as leituras indicativas.'
              : 'Nenhum jogo disponível para esta data.'}
          </div>
        )}



        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => {
            const cs = r.read;
            return (
              <article
                key={r.id}
                className="rounded-xl border border-white/10 bg-black/50 backdrop-blur-sm p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 truncate">
                      {r.league} • {r.time}
                    </p>
                    <h2 className="text-sm font-bold text-white truncate">
                      {r.homeTeam} <span className="text-gray-500">x</span> {r.awayTeam}
                    </h2>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded-md border text-[10px] font-bold ${labelColor[cs.label]}`}>
                    {cs.label} • {cs.confidence}%
                  </span>
                </div>

                {/* Top placares */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {cs.top.slice(0, 3).map((c, i) => (
                    <div
                      key={`${c.home}-${c.away}`}
                      className={`rounded-lg border p-2 text-center ${
                        i === 0 ? 'border-orange-500/40 bg-orange-500/10' : 'border-white/10 bg-white/5'
                      }`}
                    >
                      <p className="font-display text-xl leading-none text-white">
                        {c.home}-{c.away}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">{pct(c.prob)}</p>
                      <p className="text-[10px] text-gray-500">justa {c.fairOdd.toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                {/* Combinação sugerida */}
                <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Combinação sugerida (3 placares)
                  </p>
                  <p className="text-xs text-gray-200 mt-1">
                    {cs.combo.map((c) => `${c.home}-${c.away}`).join('  •  ')}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Cobertura {pct(cs.comboProb)} — odd mínima por placar para lucro:{' '}
                    <span className="text-emerald-400 font-bold">{cs.comboFairOdd.toFixed(2)}</span>
                  </p>
                </div>

                {/* Contexto */}
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[
                    { k: 'Casa', v: pct(cs.outcome.home) },
                    { k: 'Empate', v: pct(cs.outcome.draw) },
                    { k: 'Fora', v: pct(cs.outcome.away) },
                    { k: 'Over 2.5', v: pct(cs.over25) },
                  ].map((x) => (
                    <div key={x.k} className="rounded-md bg-white/5 border border-white/10 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-gray-500">{x.k}</p>
                      <p className="text-xs font-bold text-white">{x.v}</p>
                    </div>
                  ))}
                </div>

                {!cs.hasRealData && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-amber-200">
                      Sem histórico real confirmado destas equipes — leitura apenas indicativa, não recomendada para entrada.
                    </p>
                  </div>
                )}

                <ul className="mt-2 space-y-0.5">
                  {cs.reasons.map((t) => (
                    <li key={t} className="text-[10px] text-gray-400 leading-snug">• {t}</li>
                  ))}
                </ul>

                <p className="mt-2 text-[10px] text-gray-500">
                  λ {cs.homeLambda.toFixed(2)} x {cs.awayLambda.toFixed(2)} • amostra{' '}
                  {cs.sample.home}+{cs.sample.away} jogos • BTTS {pct(cs.btts)} • Under 2.5 {pct(cs.under25)}
                </p>

              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default CorrectScore;
