import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Database } from 'lucide-react';
import {
  listSources,
  getProviderLog,
  probeAllSources,
  getMatchesByDate,
  type SourceProbe,
} from '@/services/dataProvider';
import { getAlerts, clearAlerts, runHealthCheck, type HealthAlert } from '@/services/dataProvider/healthAlerts';
import { getTodayInPara, APP_TIMEZONE } from '@/lib/timezone';
import { MatchData } from '@/types/match';
import { Bell, Trash2, Trophy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const DAYS = 3;

function buildDates(n: number): string[] {
  const today = getTodayInPara();
  const base = new Date(`${today}T12:00:00-03:00`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    out.push(new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d));
  }
  return out;
}

const STATUS_COLOR: Record<string, string> = {
  ok: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  empty: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
  error: 'text-red-400 border-red-500/30 bg-red-500/10',
};

const SOURCE_COLOR: Record<string, string> = {
  'football-api-edge': 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'thesportsdb-public': 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  'stale-local-cache': 'bg-gray-500/20 text-gray-300 border-gray-500/40',
};

const Diagnostics = () => {
  const [loading, setLoading] = useState(false);
  const [probes, setProbes] = useState<Record<string, SourceProbe[]>>({});
  const [matchesByDate, setMatchesByDate] = useState<Record<string, MatchData[]>>({});
  const [log, setLog] = useState(getProviderLog());
  const [alerts, setAlerts] = useState<HealthAlert[]>(getAlerts());
  const [wcSignals, setWcSignals] = useState<any[]>([]);
  const [wcLoading, setWcLoading] = useState(false);

  const dates = useMemo(() => buildDates(DAYS), []);
  const sources = useMemo(() => listSources(), []);

  const run = async () => {
    setLoading(true);
    try {
      const probeResults: Record<string, SourceProbe[]> = {};
      const matchResults: Record<string, MatchData[]> = {};
      for (const d of dates) {
        probeResults[d] = await probeAllSources(d);
        matchResults[d] = await getMatchesByDate(d);
      }
      setProbes(probeResults);
      setMatchesByDate(matchResults);
      setLog(getProviderLog());
      await runHealthCheck();
      setAlerts(getAlerts());
    } finally {
      setLoading(false);
    }
  };

  const loadWorldCup = async () => {
    setWcLoading(true);
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('telegram_signals')
        .select('id, created_at, match_id, match_name, market, minute, confidence, success, status, reason, error_message')
        .or('reason.ilike.%world cup%,reason.ilike.%🌍%,match_name.ilike.%fifa%')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error) setWcSignals(data || []);
    } finally {
      setWcLoading(false);
    }
  };

  useEffect(() => {
    run();
    const onAlert = () => setAlerts(getAlerts());
    window.addEventListener('dp:health-alert', onAlert);
    return () => window.removeEventListener('dp:health-alert', onAlert);
    /* eslint-disable-next-line */
  }, []);

  const errors = log.filter(l => l.status === 'error').slice(0, 20);

  // Agregado por fonte (somando todas as datas do probe)
  const aggregate = useMemo(() => {
    const map: Record<string, { count: number; totalMs: number; runs: number; errors: number }> = {};
    for (const d of Object.keys(probes)) {
      for (const p of probes[d]) {
        const e = map[p.source] || { count: 0, totalMs: 0, runs: 0, errors: 0 };
        e.count += p.count;
        e.totalMs += p.durationMs;
        e.runs += 1;
        if (p.status === 'error') e.errors += 1;
        map[p.source] = e;
      }
    }
    return map;
  }, [probes]);

  // Auditoria avançada — responde itens 3, 4, 7, 8, 9
  const audit = useMemo(() => {
    const all = Object.values(matchesByDate).flat() as any[];
    const bySource: Record<string, number> = {};
    const leaguesBySource: Record<string, Set<string>> = {};
    for (const m of all) {
      const s = m.__source || 'unknown';
      bySource[s] = (bySource[s] || 0) + 1;
      (leaguesBySource[s] = leaguesBySource[s] || new Set()).add(m.league || '—');
    }
    const primary = bySource['football-api-edge'] || 0;
    const secondary = bySource['thesportsdb-public'] || 0;
    const stale = bySource['stale-local-cache'] || 0;
    // Cobertura: % de jogos da secundária em relação à primária
    const coverage = primary > 0 ? Math.round((secondary / primary) * 100) : (secondary > 0 ? 100 : 0);
    // Exclusivos da secundária = jogos que só ela trouxe (após dedupe, todo m.__source==='thesportsdb-public' já é exclusivo)
    const exclusiveSecondary = secondary;
    // Ligas exclusivas por fonte
    const allLeagues = new Set<string>();
    Object.values(leaguesBySource).forEach(s => s.forEach(l => allLeagues.add(l)));
    const exclusiveLeagues: Record<string, string[]> = {};
    for (const src of Object.keys(leaguesBySource)) {
      const others = new Set<string>();
      for (const o of Object.keys(leaguesBySource)) if (o !== src) leaguesBySource[o].forEach(l => others.add(l));
      exclusiveLeagues[src] = [...leaguesBySource[src]].filter(l => !others.has(l));
    }
    // Risco de tela vazia se a principal cair
    const fallbackTotal = secondary + stale;
    let resilience: 'alta' | 'média' | 'baixa' = 'baixa';
    let emptyRisk = 'ALTO — sem fallback ativo';
    if (fallbackTotal >= 20) { resilience = 'alta'; emptyRisk = 'BAIXO — fallback robusto'; }
    else if (fallbackTotal >= 5) { resilience = 'média'; emptyRisk = 'MÉDIO — fallback parcial'; }
    return { bySource, primary, secondary, stale, coverage, exclusiveSecondary, exclusiveLeagues, resilience, emptyRisk };
  }, [matchesByDate]);


  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-gray-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Database className="w-6 h-6 text-orange-400" />
                Diagnóstico — Data Provider
              </h1>
              <p className="text-sm text-gray-400">Tempo de resposta, contagem por fonte e erros recentes. Acesso restrito ao admin.</p>
            </div>
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-black font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Re-testar
          </button>
        </header>

        {/* Alertas automáticos */}
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Bell className="w-5 h-5 text-orange-400" />
              Alertas automáticos
              {alerts.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/40">
                  {alerts.length}
                </span>
              )}
            </h2>
            {alerts.length > 0 && (
              <button
                onClick={() => { clearAlerts(); setAlerts([]); }}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Limpar
              </button>
            )}
          </div>
          {alerts.length === 0 ? (
            <div className="text-sm text-gray-500">
              Nenhum alerta. O sistema verifica a saúde do provider a cada 5 minutos enquanto você navega como admin.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-zinc-800">
              {alerts.map(a => (
                <div key={a.id} className="py-2 flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 px-2 py-0.5 rounded text-[10px] border ${
                    a.severity === 'critical' ? 'bg-red-500/20 text-red-300 border-red-500/40' :
                    a.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' :
                    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  }`}>{a.type}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{a.message}</div>
                    <div className="text-[10px] text-gray-500">{new Date(a.ts).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fontes registradas */}
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-3">Fontes registradas</h2>
          <div className="flex flex-wrap gap-2">
            {sources.map(s => (
              <span key={s.name} className={`px-3 py-1 rounded-full text-xs border ${SOURCE_COLOR[s.name] || 'bg-zinc-700/40 text-zinc-200 border-zinc-600'}`}>
                {s.name} <span className="opacity-60">· prio {s.priority}</span>
              </span>
            ))}
          </div>
        </section>

        {/* Agregado por fonte */}
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
          <h2 className="text-lg font-semibold mb-3">Resumo por fonte ({DAYS} dias)</h2>
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left">
              <tr><th className="py-2">Fonte</th><th>Partidas</th><th>Tempo médio</th><th>Execuções</th><th>Erros</th></tr>
            </thead>
            <tbody>
              {Object.entries(aggregate).map(([name, a]) => (
                <tr key={name} className="border-t border-zinc-800">
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs border ${SOURCE_COLOR[name] || ''}`}>{name}</span></td>
                  <td>{a.count}</td>
                  <td>{a.runs ? Math.round(a.totalMs / a.runs) : 0} ms</td>
                  <td>{a.runs}</td>
                  <td className={a.errors ? 'text-red-400' : ''}>{a.errors}</td>
                </tr>
              ))}
              {Object.keys(aggregate).length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-gray-500">Rodando teste...</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Auditoria — responde itens 1-9 */}
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-3">Auditoria completa ({DAYS} dias)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-left">
                <tr><th className="py-2">#</th><th>Métrica</th><th>Valor</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-800"><td className="py-2">1</td><td>Partidas via football-api-edge</td><td className="font-mono">{audit.primary}</td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">2</td><td>Partidas via thesportsdb-public</td><td className="font-mono">{audit.secondary}</td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">3</td><td>Exclusivas da secundária (preencheram lacunas)</td><td className="font-mono">{audit.exclusiveSecondary}</td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">4</td><td>Partidas via stale-local-cache</td><td className="font-mono">{audit.stale}</td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">5</td><td>Tempo médio por fonte</td><td className="font-mono text-xs">{Object.entries(aggregate).map(([n,a])=>`${n}: ${a.runs?Math.round(a.totalMs/a.runs):0}ms`).join(' · ')}</td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">6</td><td>Erros recentes registrados</td><td className="font-mono">{errors.length}</td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">7</td><td>Cobertura secundária / principal</td><td className="font-mono">{audit.coverage}%</td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">8</td><td>Ligas exclusivas por fonte</td><td className="text-xs">
                  {Object.entries(audit.exclusiveLeagues).map(([s,ls]) => (
                    <div key={s}><span className={`px-1.5 py-0.5 rounded border ${SOURCE_COLOR[s]||''}`}>{s}</span> <span className="text-gray-400">{ls.length===0?'—':ls.slice(0,8).join(', ')}{ls.length>8?` (+${ls.length-8})`:''}</span></div>
                  ))}
                </td></tr>
                <tr className="border-t border-zinc-800"><td className="py-2">9</td><td>Risco de tela vazia se a API principal cair</td><td className={audit.resilience==='alta'?'text-emerald-400':audit.resilience==='média'?'text-yellow-400':'text-red-400'}>{audit.emptyRisk}</td></tr>
                <tr className="border-t border-zinc-800 bg-zinc-800/40"><td className="py-2 font-bold">★</td><td className="font-bold">Nível de resiliência atual</td><td className={`font-bold uppercase ${audit.resilience==='alta'?'text-emerald-400':audit.resilience==='média'?'text-yellow-400':'text-red-400'}`}>{audit.resilience}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Probe por data */}
        {dates.map(d => (
          <section key={d} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-3">Data: <span className="text-orange-400">{d}</span></h2>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-left">
                  <tr><th className="py-2">Fonte</th><th>Status</th><th>Partidas</th><th>Tempo</th><th>Erro</th></tr>
                </thead>
                <tbody>
                  {(probes[d] || []).map(p => (
                    <tr key={p.source} className="border-t border-zinc-800">
                      <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs border ${SOURCE_COLOR[p.source] || ''}`}>{p.source}</span></td>
                      <td><span className={`px-2 py-0.5 rounded text-xs border ${STATUS_COLOR[p.status]}`}>{p.status}</span></td>
                      <td>{p.count}</td>
                      <td>{p.durationMs} ms</td>
                      <td className="text-red-400 text-xs">{p.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details>
              <summary className="cursor-pointer text-sm text-gray-300 hover:text-white">
                Partidas resultantes ({(matchesByDate[d] || []).length}) — fonte por partida
              </summary>
              <div className="mt-3 max-h-80 overflow-y-auto border border-zinc-800 rounded-lg divide-y divide-zinc-800">
                {(matchesByDate[d] || []).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="truncate">
                      <span className="text-gray-400 text-xs">{m.league}</span>
                      <div className="truncate">{m.homeTeam} <span className="text-gray-500">vs</span> {m.awayTeam}</div>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] border ${SOURCE_COLOR[m.__source] || 'bg-zinc-700/40 text-zinc-200 border-zinc-600'}`}>
                      {m.__source || '—'}
                    </span>
                  </div>
                ))}
                {(matchesByDate[d] || []).length === 0 && (
                  <div className="p-3 text-center text-gray-500 text-sm">Nenhuma partida.</div>
                )}
              </div>
            </details>
          </section>
        ))}

        {/* Erros recentes */}
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Últimos erros do Data Provider
          </h2>
          {errors.length === 0 ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle2 className="w-4 h-4" /> Nenhum erro registrado.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-left">
                  <tr><th className="py-2">Quando</th><th>Data</th><th>Fonte</th><th>Tempo</th><th>Mensagem</th></tr>
                </thead>
                <tbody>
                  {errors.map((e, i) => (
                    <tr key={i} className="border-t border-zinc-800">
                      <td className="py-2 text-xs text-gray-400">{new Date(e.ts).toLocaleString('pt-BR')}</td>
                      <td>{e.date}</td>
                      <td><span className={`px-2 py-0.5 rounded text-xs border ${SOURCE_COLOR[e.source] || ''}`}>{e.source}</span></td>
                      <td>{e.durationMs ?? '—'} ms</td>
                      <td className="text-red-400 text-xs">{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default Diagnostics;
