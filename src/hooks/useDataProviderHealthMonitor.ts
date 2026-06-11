import { useEffect } from 'react';
import { toast } from 'sonner';
import { runHealthCheck, type HealthAlert } from '@/services/dataProvider/healthAlerts';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min

/**
 * Hook que monitora a saúde do Data Provider e exibe toasts ao admin.
 * Deve ser usado apenas dentro de áreas restritas (AdminRoute).
 */
export function useDataProviderHealthMonitor(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const showToast = (a: HealthAlert) => {
      const opts = { description: new Date(a.ts).toLocaleString('pt-BR'), duration: 10000 };
      if (a.severity === 'critical') toast.error(`⚠️ ${a.message}`, opts);
      else if (a.severity === 'warning') toast.warning(a.message, opts);
      else toast.success(a.message, opts);
    };

    const tick = async () => {
      const alerts = await runHealthCheck();
      if (cancelled) return;
      alerts.forEach(showToast);
    };

    // Listener global (caso outras partes do app disparem alertas)
    const onAlert = (e: Event) => showToast((e as CustomEvent).detail);
    window.addEventListener('dp:health-alert', onAlert as EventListener);

    tick();
    const id = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('dp:health-alert', onAlert as EventListener);
    };
  }, [enabled]);
}
