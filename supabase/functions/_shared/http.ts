// =====================================================================
// _shared/http.ts — fetch instrumentado para fontes externas
// ---------------------------------------------------------------------
// Objetivos (auditoria de produção):
//   • timeout individual sempre presente (AbortController) — nenhuma função
//     pode ficar presa esperando uma API externa;
//   • retry com backoff apenas para erros transitórios (429/5xx/rede);
//   • log estruturado e SEM segredos: fonte, endpoint sanitizado, status,
//     duração, motivo da falha e quantidade de resultados;
//   • deadline global opcional para limitar o wall-clock da função.
// =====================================================================

export interface FetchResult<T> {
  ok: boolean;
  status: number;
  ms: number;
  json: T | null;
  error?: string;
  attempts: number;
}

/** Remove querystring sensível (api key, token) antes de logar. */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (/key|token|secret|apikey|auth/i.test(k)) u.searchParams.set(k, "***");
    }
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return "invalid-url";
  }
}

export interface JsonFetchOptions {
  source: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  /** Epoch ms — não inicia nova tentativa depois deste instante. */
  deadline?: number;
  /** Loga a contagem de resultados quando informada pelo caller. */
  label?: string;
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchJson<T = unknown>(
  url: string,
  opts: JsonFetchOptions,
): Promise<FetchResult<T>> {
  const {
    source, timeoutMs = 8000, retries = 1, headers = {},
    method = "GET", body, deadline, label,
  } = opts;
  const safe = sanitizeUrl(url);
  const t0 = Date.now();
  let attempts = 0;
  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (deadline && Date.now() > deadline) {
      lastError = "deadline_exceeded";
      break;
    }
    attempts++;
    const ctrl = new AbortController();
    const budget = deadline
      ? Math.max(1000, Math.min(timeoutMs, deadline - Date.now()))
      : timeoutMs;
    const to = setTimeout(() => ctrl.abort(), budget);
    const started = Date.now();
    try {
      const res = await fetch(url, { method, body, headers, signal: ctrl.signal });
      clearTimeout(to);
      lastStatus = res.status;
      const text = await res.text();
      let json: T | null = null;
      try { json = text ? JSON.parse(text) as T : null; } catch { json = null; }

      if (res.ok) {
        console.log(
          `[${source}] ${label ? label + " " : ""}url=${safe} status=${res.status} duration=${Date.now() - t0}ms attempts=${attempts}`,
        );
        return { ok: true, status: res.status, ms: Date.now() - t0, json, attempts };
      }

      lastError = res.status === 429
        ? "rate_limit"
        : res.status === 401 || res.status === 403
        ? "unauthorized"
        : res.status === 404
        ? "not_found"
        : `http_${res.status}`;

      // 4xx não-transitório: não adianta repetir
      if (!TRANSIENT.has(res.status)) break;
    } catch (e) {
      clearTimeout(to);
      const msg = e instanceof Error ? e.message : String(e);
      lastError = /abort/i.test(msg) ? `timeout_${budget}ms` : `network:${msg.slice(0, 80)}`;
      lastStatus = 0;
    }

    // backoff exponencial com jitter — evita tempestade de requisições
    if (attempt < retries) {
      const wait = Math.min(4000, 400 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
      if (deadline && Date.now() + wait > deadline) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    void started;
  }

  console.warn(
    `[${source}] ${label ? label + " " : ""}url=${safe} status=${lastStatus} duration=${Date.now() - t0}ms attempts=${attempts} error=${lastError}`,
  );
  return { ok: false, status: lastStatus, ms: Date.now() - t0, json: null, error: lastError, attempts };
}

/** Executa `fn` sobre `items` com concorrência limitada e deadline global. */
export async function pMapDeadline<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  deadline: number,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let idx = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (idx < items.length) {
        const i = idx++;
        if (Date.now() > deadline) return;
        try { out[i] = await fn(items[i]); } catch { out[i] = null; }
      }
    },
  );
  await Promise.all(workers);
  return out;
}
