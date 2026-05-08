// ═══════════════════════════════════════════════════════════════
// Timezone helpers — America/Sao_Paulo (BRT, UTC-3)
// Shared by all edge functions. Garante que "hoje", "agora" e
// horários exibidos sigam o fuso de Brasília.
// ═══════════════════════════════════════════════════════════════

export const APP_TZ = 'America/Sao_Paulo';

/** Date object cujo wall-clock representa o horário atual em São Paulo. */
export function brNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: APP_TZ }));
}

/** YYYY-MM-DD do dia atual (ou de uma data) em BRT. */
export function brTodayDate(d: Date | string | number = new Date()): string {
  const date = d instanceof Date ? d : new Date(d);
  // en-CA produz YYYY-MM-DD diretamente
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** DD/MM/YYYY em BRT. */
export function brDate(d: Date | string | number): string {
  return new Date(d).toLocaleDateString('pt-BR', {
    timeZone: APP_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/** HH:mm em BRT. */
export function brTime(d: Date | string | number): string {
  return new Date(d).toLocaleTimeString('pt-BR', {
    timeZone: APP_TZ, hour: '2-digit', minute: '2-digit',
  });
}

/** DD/MM HH:mm em BRT. */
export function brDateTime(d: Date | string | number): string {
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: APP_TZ, day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Hora (0-23) de uma data em BRT — usado para classificar manhã/tarde/noite. */
export function brHour(d: Date | string | number): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TZ, hour: '2-digit', hour12: false,
  }).format(new Date(d));
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? n : NaN;
}

/** ISO timestamp do início do dia atual em BRT (00:00 BRT → UTC). */
export function brStartOfTodayISO(): string {
  // Em BRT (UTC-3 sem DST) 00:00 = 03:00 UTC do mesmo YYYY-MM-DD
  const day = brTodayDate();
  return `${day}T03:00:00.000Z`;
}
