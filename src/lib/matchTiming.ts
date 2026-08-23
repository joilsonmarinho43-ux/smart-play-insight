// Utilitário de horário: só sugerir jogos que ainda não começaram.
// Evita listar partidas já encerradas (que o usuário não acha na casa de aposta).

const TZ_OFFSET_MIN = -180; // UTC-3 (America/Belem / Sao Paulo sem horário de verão)

/** Extrai a data/hora de início do jogo a partir dos formatos usados no app. */
export function getKickoffDate(m: any): Date | null {
  const raw =
    m?.fixture?.date ?? m?.date ?? m?.kickoff ?? m?.startTime ?? m?.utcDate ?? null;
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: string já formatada "dd/MM, HH:mm" ou "HH:mm" (UTC-3)
  const t: string = typeof m?.time === 'string' ? m.time : '';
  const full = t.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?[, ]+(\d{1,2}):(\d{2})/);
  const now = new Date();
  if (full) {
    const [, dd, mm, yyyy, hh, mi] = full;
    const year = yyyy ? Number(yyyy) : now.getUTCFullYear();
    const ms = Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(mi)) - TZ_OFFSET_MIN * 60_000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const only = t.match(/^(\d{1,2}):(\d{2})$/);
  if (only) {
    const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
    const ms =
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(only[1]), Number(only[2])) -
      TZ_OFFSET_MIN * 60_000;
    return new Date(ms);
  }
  return null;
}

/**
 * O jogo ainda pode ser apostado?
 * - status encerrado/ao vivo => não
 * - kickoff no passado (com tolerância de 5 min) => não
 * - sem data confiável => não (não inventamos disponibilidade)
 */
export function isUpcomingMatch(m: any, toleranceMin = 5): boolean {
  const status = String(m?.status ?? m?.fixture?.status?.short ?? '').toUpperCase();
  if (status) {
    const finished = ['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO', 'FINISHED', 'SUSP'];
    const live = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INPLAY'];
    if (finished.includes(status) || live.includes(status)) return false;
  }
  const k = getKickoffDate(m);
  if (!k) return false;
  return k.getTime() > Date.now() - toleranceMin * 60_000;
}
