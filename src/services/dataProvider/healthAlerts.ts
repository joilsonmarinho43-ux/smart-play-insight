// =====================================================================
// HEALTH ALERTS — Monitora saúde do Data Provider e dispara notificações
// ao admin quando:
//  • A API principal (football-api-edge) fica indisponível
//  • O risco de tela vazia cai para BAIXA resiliência
//
// Funciona apenas client-side, sem alterar UX dos usuários finais.
// =====================================================================

import { probeAllSources, type SourceProbe } from './index';
import { getTodayInPara } from '@/lib/timezone';

export type HealthAlert = {
  id: string;
  ts: number;
  type: 'primary_down' | 'resilience_low' | 'recovered';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details?: Record<string, any>;
};

const ALERTS_KEY = 'data_provider_alerts_v1';
const STATE_KEY = 'data_provider_health_state_v1';
const MAX_ALERTS = 50;

type HealthState = {
  primaryDown: boolean;
  resilience: 'alta' | 'média' | 'baixa' | 'unknown';
  lastCheckTs: number;
};

function readState(): HealthState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { primaryDown: false, resilience: 'unknown', lastCheckTs: 0 };
}

function writeState(s: HealthState) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
}

export function getAlerts(): HealthAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function clearAlerts() {
  try { localStorage.removeItem(ALERTS_KEY); } catch {}
}

function pushAlert(a: Omit<HealthAlert, 'id' | 'ts'>) {
  const alert: HealthAlert = {
    ...a,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
  };
  try {
    const arr = getAlerts();
    arr.unshift(alert);
    localStorage.setItem(ALERTS_KEY, JSON.stringify(arr.slice(0, MAX_ALERTS)));
  } catch {}
  // Dispatch global event so any listener (toast, banner) reage
  try { window.dispatchEvent(new CustomEvent('dp:health-alert', { detail: alert })); } catch {}
  return alert;
}

/**
 * Roda um ciclo de checagem de saúde. Retorna os alertas gerados nessa rodada.
 * Apenas dispara alertas em transições de estado (evita spam).
 */
export async function runHealthCheck(): Promise<HealthAlert[]> {
  const date = getTodayInPara();
  let probes: SourceProbe[] = [];
  try {
    probes = await probeAllSources(date);
  } catch {
    return [];
  }

  const byName: Record<string, SourceProbe> = {};
  for (const p of probes) byName[p.source] = p;

  const primary = byName['sportsrc'];
  const fdo = byName['football-data-org'];
  const tsdb = byName['thesportsdb-public'];
  const stale = byName['stale-local-cache'];

  const primaryDown = !primary || primary.status === 'error' || (primary.status === 'empty' && (primary.durationMs ?? 0) > 0);
  const fallbackTotal = (fdo?.count || 0) + (tsdb?.count || 0) + (stale?.count || 0);
  const resilience: HealthState['resilience'] =
    fallbackTotal >= 20 ? 'alta' : fallbackTotal >= 5 ? 'média' : 'baixa';

  const prev = readState();
  const newAlerts: HealthAlert[] = [];

  // Transição: principal caiu
  if (primaryDown && !prev.primaryDown) {
    newAlerts.push(pushAlert({
      type: 'primary_down',
      severity: 'critical',
      message: 'API principal (SportsRC) indisponível. Sistema operando em fallback (Football-Data.org / TheSportsDB).',
      details: {
        error: primary?.error,
        footballDataOrgCount: fdo?.count || 0,
        theSportsDbCount: tsdb?.count || 0,
        staleCount: stale?.count || 0,
      },
    }));
  }

  // Transição: resiliência caiu para BAIXA
  if (resilience === 'baixa' && prev.resilience !== 'baixa') {
    newAlerts.push(pushAlert({
      type: 'resilience_low',
      severity: 'critical',
      message: `Risco de tela vazia ALTO — resiliência BAIXA (fallback total: ${fallbackTotal} partidas).`,
      details: { primary: primary?.count || 0, fdo: fdo?.count || 0, tsdb: tsdb?.count || 0, stale: stale?.count || 0 },
    }));
  }

  // Transição: recuperação
  if (!primaryDown && prev.primaryDown) {
    newAlerts.push(pushAlert({
      type: 'recovered',
      severity: 'info',
      message: `API principal recuperada (${primary?.count || 0} partidas).`,
    }));
  }

  writeState({ primaryDown, resilience, lastCheckTs: Date.now() });
  return newAlerts;
}
