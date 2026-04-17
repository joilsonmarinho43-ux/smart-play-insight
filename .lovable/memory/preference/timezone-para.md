---
name: Timezone Mãe do Rio (UTC-3)
description: Toda exibição de horário e cálculo de "hoje" usa America/Belem (UTC-3, sem DST). Helpers em src/lib/timezone.ts.
type: preference
---
- `APP_TIMEZONE = 'America/Belem'` em `src/lib/timezone.ts`.
- `getTodayInPara()` retorna YYYY-MM-DD em UTC-3 — usado para limites diários (5/dia) e agrupamento do painel de performance.
- `formatTimePara(date)` e `formatDateTimePara(date)` formatam em pt-BR + timezone Belém.
- Nas páginas /scanner e /elite, horários de jogos formatados via Intl.DateTimeFormat com `timeZone: 'America/Belem'`.
