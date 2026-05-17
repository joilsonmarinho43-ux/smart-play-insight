import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Activity, AlertTriangle, Zap, Clock, Skull, Flame } from "lucide-react";

type BehaviorRow = { subject: string; total: number; wins: number; avg_time_min: number | null; avg_pressure: number | null };
type WindowRow = { subject: string; total: number; wins: number; avg_time_min: number | null; avg_drop: number | null };
type LeagueRow = { subject: string; total: number; wins: number; fakes: number; deaths: number; avg_pressure: number | null; avg_drop: number | null };
type MarketRow = { subject: string; total: number; wins: number; avg_time_min: number | null; avg_pressure: number | null };

interface CtxAnalytics {
  window_days: number;
  overall: {
    total: number;
    avg_time_to_goal_min: number | null;
    avg_entry_pressure: number | null;
    avg_sustained_pressure: number | null;
    avg_pressure_drop: number | null;
    avg_snapshots: number | null;
  } | null;
  by_behavior: BehaviorRow[];
  by_entry_window: WindowRow[];
  by_league: LeagueRow[];
  by_market: MarketRow[];
}

const wr = (w: number, t: number) => (t > 0 ? (w / t) * 100 : 0);

const behaviorMeta: Record<string, { color: string; icon: any; label: string }> = {
  explosivo: { color: "text-orange-400 border-orange-500/30 bg-orange-500/10", icon: Flame, label: "Explosivo" },
  consistente: { color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", icon: Activity, label: "Consistente" },
  tardio: { color: "text-blue-400 border-blue-500/30 bg-blue-500/10", icon: Clock, label: "Tardio" },
  precoce: { color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: Clock, label: "Precoce" },
  fake_pressure: { color: "text-red-400 border-red-500/30 bg-red-500/10", icon: AlertTriangle, label: "Fake pressure" },
  pressao_sustentavel: { color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10", icon: Zap, label: "Pressão sustentável" },
  alta_volatilidade: { color: "text-purple-400 border-purple-500/30 bg-purple-500/10", icon: Activity, label: "Alta volatilidade" },
  dead_after_entry: { color: "text-gray-400 border-gray-500/30 bg-gray-500/10", icon: Skull, label: "Morreu após entrada" },
  neutro: { color: "text-gray-400 border-gray-500/30 bg-gray-500/10", icon: Activity, label: "Neutro" },
  insuficiente: { color: "text-gray-500 border-gray-600/30 bg-gray-600/10", icon: Activity, label: "Sem dados" },
};

const pctBadge = (v: number) => {
  const color = v >= 65 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : v >= 50 ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : "bg-red-500/15 text-red-400 border-red-500/30";
  return <Badge variant="outline" className={`${color} font-bold`}>{v.toFixed(1)}%</Badge>;
};

export default function Context() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CtxAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      const { data: d, error } = await supabase.rpc("get_signal_context_analytics", { p_days: days });
      if (cancelled) return;
      if (error) setErr(error.message);
      else setData(d as unknown as CtxAnalytics);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [days]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;
  if (err) return <div className="p-6 text-red-400">{err}</div>;
  if (!data) return null;

  const o = data.overall;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-wider text-orange-500 uppercase">
            Contexto dos Sinais
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Comportamento entre entrada e resultado • janela: {data.window_days}d
          </p>
        </div>
        <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <TabsList className="bg-[#0f172a] border border-white/10">
            <TabsTrigger value="7">7d</TabsTrigger>
            <TabsTrigger value="30">30d</TabsTrigger>
            <TabsTrigger value="90">90d</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {/* Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Sinais rastreados</div>
          <div className="font-display text-3xl text-white mt-1">{o?.total ?? 0}</div>
        </Card>
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Tempo médio até gol</div>
          <div className="font-display text-3xl text-emerald-400 mt-1">
            {o?.avg_time_to_goal_min != null ? `${Number(o.avg_time_to_goal_min).toFixed(1)}min` : "—"}
          </div>
        </Card>
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Pressão entrada</div>
          <div className="font-display text-3xl text-blue-400 mt-1">{Number(o?.avg_entry_pressure ?? 0).toFixed(1)}</div>
          <div className="text-xs text-gray-500 mt-1">Sustentada: {Number(o?.avg_sustained_pressure ?? 0).toFixed(1)}</div>
        </Card>
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Queda média</div>
          <div className="font-display text-3xl text-amber-400 mt-1">
            {((o?.avg_pressure_drop ?? 0) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">{Number(o?.avg_snapshots ?? 0).toFixed(1)} snaps/sinal</div>
        </Card>
      </div>

      {/* Behavior breakdown */}
      <Card className="bg-[#0f172a] border-white/10 p-4">
        <h3 className="font-display text-lg text-white tracking-wider uppercase mb-3">Classificação comportamental</h3>
        {data.by_behavior.length === 0 ? (
          <div className="text-sm text-gray-500">Sem dados ainda — aguarde alguns sinais finalizarem.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {data.by_behavior.map((b) => {
              const meta = behaviorMeta[b.subject] ?? behaviorMeta.neutro;
              const Icon = meta.icon;
              const winrate = wr(b.wins, b.total);
              return (
                <div key={b.subject} className={`p-3 rounded-md border ${meta.color}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-bold">{meta.label}</span>
                    </div>
                    <span className="text-xs opacity-70">{b.total}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="opacity-70">WR {winrate.toFixed(1)}%</span>
                    <span className="opacity-70">
                      {b.avg_time_min != null ? `${Number(b.avg_time_min).toFixed(1)}min` : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Entry windows */}
      <Card className="bg-[#0f172a] border-white/10 p-4">
        <h3 className="font-display text-lg text-white tracking-wider uppercase mb-3">Janela de entrada</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-gray-500 border-b border-white/10">
              <tr><th className="text-left py-2">Faixa</th><th>Sinais</th><th>WR</th><th>Tempo médio</th><th>Queda</th></tr>
            </thead>
            <tbody>
              {data.by_entry_window.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-gray-500">Sem dados</td></tr>
              )}
              {data.by_entry_window.map((w) => (
                <tr key={w.subject} className="border-b border-white/5">
                  <td className="py-2 text-gray-300">{w.subject}min</td>
                  <td className="text-center text-gray-400">{w.total}</td>
                  <td className="text-center">{pctBadge(wr(w.wins, w.total))}</td>
                  <td className="text-center text-gray-300">{w.avg_time_min != null ? `${Number(w.avg_time_min).toFixed(1)}m` : "—"}</td>
                  <td className="text-center text-amber-300">{((w.avg_drop ?? 0) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* By league */}
      <Card className="bg-[#0f172a] border-white/10 p-4">
        <h3 className="font-display text-lg text-white tracking-wider uppercase mb-3">Comportamento por liga</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-gray-500 border-b border-white/10">
              <tr>
                <th className="text-left py-2">Liga</th>
                <th>Sinais</th><th>WR</th>
                <th title="fake pressure">Fakes</th>
                <th title="morreu após entrada">Dead</th>
                <th>Pressão</th>
              </tr>
            </thead>
            <tbody>
              {data.by_league.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-gray-500">Sem dados</td></tr>
              )}
              {data.by_league.map((l) => (
                <tr key={l.subject} className="border-b border-white/5">
                  <td className="py-2 text-gray-300 truncate max-w-[200px]">{l.subject}</td>
                  <td className="text-center text-gray-400">{l.total}</td>
                  <td className="text-center">{pctBadge(wr(l.wins, l.total))}</td>
                  <td className="text-center text-red-400">{l.fakes}</td>
                  <td className="text-center text-gray-500">{l.deaths}</td>
                  <td className="text-center text-blue-300">{Number(l.avg_pressure ?? 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* By market */}
      <Card className="bg-[#0f172a] border-white/10 p-4">
        <h3 className="font-display text-lg text-white tracking-wider uppercase mb-3">Mercado × estabilidade</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-gray-500 border-b border-white/10">
              <tr><th className="text-left py-2">Mercado</th><th>Sinais</th><th>WR</th><th>Tempo médio</th><th>Pressão</th></tr>
            </thead>
            <tbody>
              {data.by_market.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-gray-500">Sem dados</td></tr>
              )}
              {data.by_market.map((m) => (
                <tr key={m.subject} className="border-b border-white/5">
                  <td className="py-2 text-gray-300">{m.subject}</td>
                  <td className="text-center text-gray-400">{m.total}</td>
                  <td className="text-center">{pctBadge(wr(m.wins, m.total))}</td>
                  <td className="text-center text-gray-300">{m.avg_time_min != null ? `${Number(m.avg_time_min).toFixed(1)}m` : "—"}</td>
                  <td className="text-center text-blue-300">{Number(m.avg_pressure ?? 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[10px] text-gray-600 italic text-center">
        Rastreamento atualizado a cada 3 min. Sugestões aparecem no Quality Lab.
      </p>
    </div>
  );
}
