// 🎱 Pool de partidas para os broadcasts diários (placar exato / bet analyzer).
// Busca os jogos de hoje/amanhã (BRT), filtra ligas instáveis e jogos já
// iniciados e enriquece com histórico REAL das equipes via `team-form`.

import { brTodayDate } from './timezone.ts';

/** Competições ruins para modelo (amistosos, base, feminino sem base estatística). */
export const UNSTABLE = [
  'friendly', 'friendlies', 'amistos', 'amistoso',
  'u15', 'u16', 'u17', 'u18', 'u19', 'u20', 'u21', 'u23',
  'sub-15', 'sub-16', 'sub-17', 'sub-18', 'sub-19', 'sub-20', 'sub-21', 'sub-23',
  'reserve', 'reserva', 'youth', 'juvenil', 'amateur', 'amador',
  'pre-season', 'pré-temporada', 'women', 'feminino', 'femenino', 'frauen',
];

export function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/** Jogo elegível: liga estável e ainda não começou. */
export function isEligible(m: any): boolean {
  const league = (m.league?.name || m.league || '').toString();
  if (!league) return false;
  if (UNSTABLE.some((t) => league.toLowerCase().includes(t))) return false;
  const kickoff = m.fixture?.date ? new Date(m.fixture.date).getTime() : NaN;
  return Number.isFinite(kickoff) && kickoff > Date.now();
}

export function hasRealStats(m: any): boolean {
  const hs = m?.homeStats || {};
  const as_ = m?.awayStats || {};
  return num(hs.gamesCount) >= 3 && num(as_.gamesCount) >= 3 &&
    num(hs.goalsFor) > 0 && num(as_.goalsFor) > 0;
}

/** Mescla a resposta do team-form (espelha mergeFormIntoMatch do app). */
export function mergeForm(m: any, form: any): any {
  if (!form?.ok) return m;
  const h = form.home || {}, a = form.away || {};
  const hs = m.homeStats || {}, as_ = m.awayStats || {};
  const pick = (cur: any, inc: number) => (num(inc) > 0 && num(cur) <= 0 ? inc : cur ?? inc);
  return {
    ...m,
    homeStats: {
      ...hs,
      goalsFor: pick(hs.goalsFor, h.goalsForAvg),
      goalsAgainst: pick(hs.goalsAgainst, h.goalsAgainstAvg),
      gamesCount: Math.max(num(hs.gamesCount), num(h.games)),
      recentGoalsFor: hs.recentGoalsFor?.length ? hs.recentGoalsFor : h.recentGoalsFor,
      recentGoalsAgainst: hs.recentGoalsAgainst?.length ? hs.recentGoalsAgainst : h.recentGoalsAgainst,
    },
    awayStats: {
      ...as_,
      goalsFor: pick(as_.goalsFor, a.goalsForAvg),
      goalsAgainst: pick(as_.goalsAgainst, a.goalsAgainstAvg),
      gamesCount: Math.max(num(as_.gamesCount), num(a.games)),
      recentGoalsFor: as_.recentGoalsFor?.length ? as_.recentGoalsFor : a.recentGoalsFor,
      recentGoalsAgainst: as_.recentGoalsAgainst?.length ? as_.recentGoalsAgainst : a.recentGoalsAgainst,
    },
  };
}

/** Busca histórico real (últimos jogos) para as partidas sem estatística. */
export async function enrich(
  matches: any[],
  supabaseUrl: string,
  key: string,
  limit = 40,
  tag = 'POOL',
): Promise<any[]> {
  const pending = matches.filter((m) => !hasRealStats(m)).slice(0, limit);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', apikey: key };
  const map = new Map<string, any>();
  const CONC = 6;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, pending.length) }, async () => {
    while (cursor < pending.length) {
      const m = pending[cursor++];
      const home = m.teams?.home?.name || m.homeTeam;
      const away = m.teams?.away?.name || m.awayTeam;
      if (!home || !away) continue;
      try {
        const r = await fetch(`${supabaseUrl}/functions/v1/team-form`, {
          method: 'POST', headers, body: JSON.stringify({ home, away }),
        });
        const data = await r.json().catch(() => null);
        if (data?.ok) map.set(`${home}|${away}`, data);
      } catch { /* ignora falha pontual */ }
    }
  }));
  console.log(`[${tag}] enriquecidos=${map.size}/${pending.length}`);
  return matches.map((m) => {
    const k = `${m.teams?.home?.name || m.homeTeam}|${m.teams?.away?.name || m.awayTeam}`;
    const f = map.get(k);
    return f ? mergeForm(m, f) : m;
  });
}

/** Busca hoje + amanhã (BRT), filtra e enriquece. */
export async function loadMatchPool(
  supabaseUrl: string,
  key: string,
  tag = 'POOL',
): Promise<{ all: any[]; enriched: any[]; dates: string[] }> {
  const today = brTodayDate();
  const dates = [0, 1].map((i) => {
    const d = new Date(today + 'T00:00:00-03:00');
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', apikey: key };
  const results = await Promise.all(dates.map((d) =>
    fetch(`${supabaseUrl}/functions/v1/football-api`, { method: 'POST', headers, body: JSON.stringify({ date: d }) })
      .then((r) => r.json()).catch(() => ({ matches: [] }))
  ));
  const all: any[] = results.flatMap((r: any) => Array.isArray(r?.matches) ? r.matches : []);
  const pool = all.filter(isEligible);
  console.log(`[${tag}] jogos=${all.length} elegíveis=${pool.length}`);
  const enriched = await enrich(pool, supabaseUrl, key, 40, tag);
  return { all, enriched, dates };
}
