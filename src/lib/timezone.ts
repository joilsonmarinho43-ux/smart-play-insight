/**
 * Timezone helpers — Mãe do Rio, Pará (UTC-3, sem horário de verão).
 */
export const APP_TIMEZONE = 'America/Belem';
export const APP_TZ_OFFSET = '-03:00';

/** Returns YYYY-MM-DD for "today" in UTC-3 (Pará). */
export function getTodayInPara(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

/** Format a Date or ISO string as HH:mm in UTC-3. */
export function formatTimePara(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

/** Format a Date or ISO string as DD/MM HH:mm in UTC-3. */
export function formatDateTimePara(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIMEZONE,
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
