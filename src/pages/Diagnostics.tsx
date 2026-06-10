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
import { getTodayInPara, APP_TIMEZONE } from '@/lib/timezone';
import { MatchData } from '@/types/match';

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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

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
