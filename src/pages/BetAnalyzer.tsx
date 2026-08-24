import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMultiDayMatches } from '@/services/footballApi';
import { localizeTeamName } from '@/lib/teamI18n';
import { isPremiumLeague } from '@/lib/premiumLeagues';
import { APP_TIMEZONE, formatTimePara, getTodayInPara } from '@/lib/timezone';
import { useScannerEnrichment } from '@/hooks/useScannerEnrichment';
import {
  runBetAnalyzer, toAnalyzed, SCENARIOS,
  type ScenarioCard, type AnalyzedMatch,
} from '@/lib/betAnalyzerEngine';
import {
  Loader2, Crosshair, RefreshCw, AlertTriangle, Crown, Clock,
  ThumbsUp, ThumbsDown, Flame,
} from 'lucide-react';
import bgPattern from '@/assets/bg-circuit-pattern.jpg';

function paraDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function getMatchIso(match: any): string | null {
  return match?.fixture?.date || (typeof match?.time === 'string' && match.time.includes('T') ? match.time : null);
}

const LIVE_STATUS = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'IN_PLAY', 'PAUSED']);
const CLOSED_STATUS = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO', 'FINISHED', 'AWARDED', 'CANC', 'PST', 'ABD', 'POSTPONED', 'CANCELLED']);

function statusOf(match: any): string {
  return String(match?.fixture?.status?.short ?? match?.status?.short ?? match?.status ?? '').toUpperCase();
}

function isAnalyzable(match: any): boolean {
  const st = statusOf(match);
  if (CLOSED_STATUS.has(st)) return false;
  if (LIVE_STATUS.has(st)) return true;
  const iso = getMatchIso(match);
  if (iso) {
    const ts = new Date(iso).getTime();
    if (!Number.isNaN(ts) && ts < Date.now() - 10 * 60 * 1000) return false;
  }
  return true;
}

const qualityStyle: Record<ScenarioCard['quality'], string> = {
  ALTA: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  MÉDIA: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  BAIXA: 'text-gray-400 border-white/15 bg-white/5',
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 70) return 'text-lime-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-gray-400';
}

function indicatorColor(v: number): string {
  if (v >= 70) return 'text-emerald-400';
  if (v >= 50) return 'text-amber-400';
  return 'text-gray-400';
}

function indicatorBar(v: number): string {
  if (v >= 70) return 'bg-emerald-400';
  if (v >= 50) return 'bg-amber-400';
  return 'bg-gray-500';
}

const BetAnalyzer = () => {
  const queryClient = useQueryClient();
  const [selectedDay, setSelectedDay] = useState(0);
  const [onlyPremium, setOnlyPremium] = useState(false);
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'manha' | 'tarde' | 'noite'>('all');
  const [analyze, setAnalyze] = useState(true);

  const todayKey = getTodayInPara();
  const { data: rawMatches, isFetching, isError, dataUpdatedAt, refetch } = useQuery({
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

  const dayMatches = useMemo(() => {
    const selectedDate = dayOptions[selectedDay]?.date;
    return (rawMatches || [])
      .filter(isAnalyzable)
      .map((m: any) => ({
        ...m,
        homeTeam: m.homeTeam || m.teams?.home?.name || '',
        awayTeam: m.awayTeam || m.teams?.away?.name || '',
        __iso: getMatchIso(m),
      }))
      .filter((m: any) => m.homeTeam && m.awayTeam)
      .filter((m: any) => {
        const d = m.__iso ? paraDateString(new Date(m.__iso)) : m.date || '';
        return !selectedDate || d === selectedDate;
      })
      .sort((a: any, b: any) => {
        const pa = isPremiumLeague(a.league?.name || a.league || '') ? 0 : 1;
        const pb = isPremiumLeague(b.league?.name || b.league || '') ? 0 : 1;
        return pa - pb;
      });
  }, [rawMatches, dayOptions, selectedDay]);

  const leagues = useMemo(() => {
    const set = new Set<string>();
    dayMatches.forEach((m: any) => {
      const l = m.league?.name || m.league || '';
      if (l) set.add(String(l));
    });
    return Array.from(set).sort();
  }, [dayMatches]);

  const filtered = useMemo(() => {
    return dayMatches.filter((m: any) => {
      const league = String(m.league?.name || m.league || '');
      if (onlyPremium && !isPremiumLeague(league)) return false;
      if (leagueFilter !== 'all' && league !== leagueFilter) return false;
      if (periodFilter !== 'all') {
        const iso = m.__iso;
        if (!iso) return false;
        const hourTxt = formatTimePara(iso).slice(0, 2);
        const h = Number(hourTxt);
        if (!Number.isFinite(h)) return false;
        if (periodFilter === 'manha' && !(h < 12)) return false;
        if (periodFilter === 'tarde' && !(h >= 12 && h < 18)) return false;
        if (periodFilter === 'noite' && !(h >= 18)) return false;
      }
      return true;
    });
  }, [dayMatches, onlyPremium, leagueFilter, periodFilter]);

  const { matches: enriched, isEnriching } = useScannerEnrichment(filtered as any);

  const analyzed: AnalyzedMatch[] = useMemo(() => {
    return (enriched || []).map((m: any) => {
      const iso = m.__iso || getMatchIso(m);
      const league = String(m.league?.name || m.league || '');
      return toAnalyzed(m, {
        iso,
        time: iso ? formatTimePara(iso) : m.time || '',
        league,
        country: m.league?.country || m.country,
        live: LIVE_STATUS.has(statusOf(m)),
        homeTeam: localizeTeamName(m.homeTeam) || 'Casa',
        awayTeam: localizeTeamName(m.awayTeam) || 'Fora',
      });
    });
  }, [enriched]);

  const result = useMemo(() => (analyze ? runBetAnalyzer(analyzed) : null), [analyze, analyzed]);

  const loading = (isFetching || isEnriching) && analyzed.length === 0;
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit' }) : '—';

  const handleRefresh = async () => {
    clearMatchCaches();
    await queryClient.invalidateQueries({ queryKey: ['matches-multiday', todayKey] });
    refetch();
  };


  return (
    <div className="min-h-screen text-white pb-10 font-sans relative">
      <div
        className="fixed inset-0 z-0"
        style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="fixed inset-0 z-0 bg-black/55" />

      <main className="container max-w-3xl lg:max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
        <header className="pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Crosshair className="h-6 w-6 text-orange-500" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl sm:text-3xl tracking-wide uppercase text-orange-400">
                Bet Analyzer
              </h1>
              <p className="text-xs text-gray-400">
                5 cenários independentes sobre estatísticas reais das equipes
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Última atualização: {lastUpdate}
            </span>
            <span>· Data: {dayOptions[selectedDay]?.date}</span>
            <span>· {analyzed.length} jogos na seleção</span>
          </div>
        </header>

        {/* Ações */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <button
            onClick={() => setAnalyze(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-orange-500/15 border-orange-500/50 text-orange-400 hover:bg-orange-500/25 transition-colors"
          >
            Analisar Jogos
          </button>
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-white/5 border-white/10 text-gray-300 hover:text-white flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar Dados
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
          <select
            aria-label="Filtrar por campeonato"
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-gray-300 max-w-[190px]"
          >
            <option value="all">Todos os campeonatos</option>
            {leagues.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar por horário"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as any)}
            className="px-2 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-gray-300"
          >
            <option value="all">Qualquer horário</option>
            <option value="manha">Manhã (até 12h)</option>
            <option value="tarde">Tarde (12h–18h)</option>
            <option value="noite">Noite (18h+)</option>
          </select>
        </div>

        {isError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            Não foi possível carregar os jogos agora. Tente "Atualizar Dados" em alguns instantes.
          </div>
        )}

        {loading && !isError && (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
            <p className="text-xs text-gray-400">Carregando histórico real das equipes…</p>
          </div>
        )}

        {!loading && !isError && result && (
          <>
            {/* Ranking */}
            <section className="rounded-xl border border-white/10 bg-black/40 p-4 mb-4">
              <h2 className="font-display text-lg tracking-wide uppercase text-orange-400 flex items-center gap-2">
                <Flame className="h-4 w-4" /> Top 5 análises do dia
              </h2>
              <ol className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {SCENARIOS.map((s, i) => {
                  const card = result.cards.find((c) => c.scenario.key === s.key);
                  return (
                    <li key={s.key} className="flex items-center justify-between gap-2 text-xs text-gray-300 py-1">
                      <span className="truncate">
                        <span className="text-gray-500">{i + 1}º</span> {s.icon} {s.title}
                      </span>
                      <span className={`font-bold ${card ? scoreColor(card.score) : 'text-gray-600'}`}>
                        {card ? `${card.score}/100` : 'sem dados'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            {result.cards.length === 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">
                ⚠️ <strong>DADOS INSUFICIENTES</strong>
                <p className="mt-1 text-amber-200/80">
                  Não encontramos partidas com histórico real suficiente para gerar as análises deste dia.
                </p>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {result.cards.map((card) => (
                <article
                  key={card.scenario.key}
                  className="rounded-xl border border-white/10 bg-black/50 p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-widest text-gray-400">
                        {card.scenario.icon} {card.scenario.title}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {card.match.league}{card.match.country ? ` · ${card.match.country}` : ''} · {card.match.time}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-display text-2xl leading-none ${scoreColor(card.score)}`}>{card.score}</div>
                      <div className="text-[10px] text-gray-500">Score Nexus</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span className={`px-2 py-0.5 rounded border ${qualityStyle[card.quality]}`}>
                      Dados: {card.quality}
                    </span>
                    <span className="px-2 py-0.5 rounded border border-white/15 bg-white/5 text-gray-300">
                      {card.rating}
                    </span>
                    <span className={`px-2 py-0.5 rounded border ${card.match.live ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-sky-500/30 bg-sky-500/10 text-sky-300'}`}>
                      {card.match.live ? 'AO VIVO' : 'PRÉ-JOGO'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-sm font-bold text-white truncate">
                      {card.match.homeTeam} <span className="text-gray-500">x</span> {card.match.awayTeam}
                    </div>
                    <div className="mt-1 font-display text-lg tracking-wide text-orange-400">
                      {card.headline}
                    </div>
                  </div>

                  {/* Indicador dedicado do mercado */}
                  <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-widest text-gray-400 truncate">
                        {card.indicator.label}
                      </span>
                      <span className={`text-xs font-bold ${indicatorColor(card.indicator.value)}`}>
                        {card.indicator.value}/100 · {card.indicator.level}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${indicatorBar(card.indicator.value)}`}
                        style={{ width: `${Math.max(4, Math.min(100, card.indicator.value))}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-gray-300">{card.indicator.caption}</p>
                    <div className="mt-2 grid gap-1">
                      {card.indicator.components.map((c) => (
                        <div key={c.label} className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 w-[52%] truncate">{c.label}</span>
                          <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${indicatorBar(c.value)}`}
                              style={{ width: `${Math.max(3, Math.min(100, c.value))}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-gray-400 w-8 text-right">{c.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>


                  <div className="grid grid-cols-2 gap-2">
                    {card.stats.map((s) => (
                      <div key={s.label} className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5">
                        <div className="text-[10px] text-gray-500 truncate">{s.label}</div>
                        <div className="text-xs font-bold text-gray-100 truncate">{s.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="text-[11px] text-gray-400">
                    <div className="uppercase tracking-widest text-[10px] text-gray-500 mb-1">Últimos resultados (GP-GS)</div>
                    {card.recent.map((r) => (
                      <div key={r.label} className="flex gap-2 truncate">
                        <span className="text-gray-300 shrink-0 max-w-[45%] truncate">{r.label}:</span>
                        <span className="truncate">{r.values}</span>
                      </div>
                    ))}
                  </div>

                  {card.pros.length > 0 && (
                    <ul className="space-y-1">
                      {card.pros.map((p, i) => (
                        <li key={i} className="text-[11px] text-emerald-300/90 flex gap-1.5">
                          <ThumbsUp className="h-3 w-3 mt-0.5 shrink-0" /> <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {card.cons.length > 0 && (
                    <ul className="space-y-1">
                      {card.cons.map((p, i) => (
                        <li key={i} className="text-[11px] text-amber-300/90 flex gap-1.5">
                          <ThumbsDown className="h-3 w-3 mt-0.5 shrink-0" /> <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-gray-500">Por que este jogo?</div>
                    <p className="text-[11px] text-gray-300 mt-0.5">{card.why}</p>
                  </div>
                </article>
              ))}
            </div>

            {result.missing.length > 0 && result.cards.length > 0 && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {result.missing.map((s) => (
                  <div key={s.key} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-amber-200/90">
                    ⚠️ <strong>DADOS INSUFICIENTES — {s.icon} {s.title}</strong>
                    <p className="mt-0.5 text-amber-200/70">
                      Não encontramos uma partida com dados suficientes para este cenário.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <footer className="mt-8 text-[11px] text-gray-500 border-t border-white/10 pt-4">
          Análises baseadas em dados estatísticos disponíveis. Os indicadores são estimativas e não garantem resultados.
        </footer>
      </main>
    </div>
  );
};

export default BetAnalyzer;
