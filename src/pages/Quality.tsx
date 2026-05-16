import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";

type Row = { subject: string; total: number; wins: number; avg_roi: number };
type HourRow = { hour_brt: number; total: number; wins: number; avg_roi: number };
type DailyRow = { day: string; total: number; wins: number; avg_roi: number };

interface Analytics {
  window_days: number;
  generated_at: string;
  overall: {
    total: number; wins: number; losses: number; voids: number;
    avg_confidence: number; avg_roi: number; total_roi: number;
  } | null;
  by_market: Row[];
  by_strategy: Row[];
  by_hour: HourRow[];
  by_minute_window: Row[];
  by_league: Row[];
  daily: DailyRow[];
  recent_results: string[];
}

interface Suggestion {
  id: string;
  category: string;
  subject: string;
  severity: "info" | "warning" | "critical";
  metric: string;
  message: string;
  status: string;
  created_at: string;
}

const wr = (w: number, t: number) => (t > 0 ? (w / t) * 100 : 0);

const pctBadge = (v: number) => {
  const color = v >= 65 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : v >= 50 ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : "bg-red-500/15 text-red-400 border-red-500/30";
  return <Badge variant="outline" className={`${color} font-bold`}>{v.toFixed(1)}%</Badge>;
};

const roiBadge = (v: number) => {
  const positive = v >= 0;
  return (
    <Badge variant="outline" className={positive
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : "bg-red-500/15 text-red-400 border-red-500/30"}>
      {positive ? "+" : ""}{(v * 100).toFixed(1)}%
    </Badge>
  );
};

export default function Quality() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      const [a, s] = await Promise.all([
        supabase.rpc("get_signal_analytics", { p_days: days }),
        supabase
          .from("signal_suggestions")
          .select("*")
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (cancelled) return;
      if (a.error) setErr(a.error.message);
      else setData(a.data as unknown as Analytics);
      if (!s.error && s.data) setSuggestions(s.data as Suggestion[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [days]);

  async function ack(id: string) {
    await supabase.from("signal_suggestions")
      .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
      .eq("id", id);
    setSuggestions((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (err) return <div className="p-6 text-red-400">{err}</div>;
  if (!data) return null;

  const o = data.overall;
  const overallWR = o ? wr(o.wins, o.total) : 0;
  const streak = data.recent_results || [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-wider text-orange-500 uppercase">
            Quality Lab
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Análise de assertividade dos sinais • janela: {data.window_days}d
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

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Sinais</div>
          <div className="font-display text-3xl text-white mt-1">{o?.total ?? 0}</div>
          <div className="text-xs text-gray-500 mt-1">{o?.wins ?? 0}W / {o?.losses ?? 0}L / {o?.voids ?? 0}V</div>
        </Card>
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Winrate</div>
          <div className="font-display text-3xl text-emerald-400 mt-1">{overallWR.toFixed(1)}%</div>
          <div className="text-xs text-gray-500 mt-1">Conf. média: {o?.avg_confidence ?? 0}%</div>
        </Card>
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">ROI médio</div>
          <div className={`font-display text-3xl mt-1 ${(o?.avg_roi ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {(o?.avg_roi ?? 0) >= 0 ? "+" : ""}{((o?.avg_roi ?? 0) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">Total: {(o?.total_roi ?? 0).toFixed(2)}u</div>
        </Card>
        <Card className="bg-[#0f172a] border-white/10 p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Últimos 20</div>
          <div className="flex flex-wrap gap-1 mt-2">
            {streak.length === 0 && <span className="text-xs text-gray-600">Sem dados</span>}
            {streak.map((r, i) => (
              <span
                key={i}
                className={`w-3 h-3 rounded-sm ${
                  r === "WIN" || r === "GREEN" ? "bg-emerald-500"
                  : r === "LOSS" || r === "RED" ? "bg-red-500"
                  : "bg-gray-600"
                }`}
                title={r}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Sugestões */}
      {suggestions.length > 0 && (
        <Card className="bg-[#0f172a] border-amber-500/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h2 className="font-display text-lg text-amber-400 tracking-wider uppercase">
              Sugestões automáticas ({suggestions.length})
            </h2>
          </div>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 p-3 rounded-md bg-black/30 border border-white/5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={
                      s.severity === "critical" ? "bg-red-500/15 text-red-400 border-red-500/30"
                      : s.severity === "warning" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                    }>{s.severity}</Badge>
                    <span className="text-[10px] text-gray-500 uppercase">{s.category} • {s.metric}</span>
                  </div>
                  <div className="text-sm text-gray-300">{s.message}</div>
                </div>
                <button
                  onClick={() => ack(s.id)}
                  className="text-xs text-gray-400 hover:text-white px-3 py-1 rounded border border-white/10 hover:bg-white/5"
                >
                  OK
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-3 italic">
            Estas são apenas sugestões. Nenhum threshold é alterado automaticamente.
          </p>
        </Card>
      )}

      {suggestions.length === 0 && (
        <Card className="bg-[#0f172a] border-emerald-500/30 p-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400">Nenhuma degradação detectada</span>
        </Card>
      )}

      {/* Quebras */}
      <div className="grid md:grid-cols-2 gap-4">
        <BreakdownCard title="Por mercado" rows={data.by_market} />
        <BreakdownCard title="Por estratégia" rows={data.by_strategy} />
        <BreakdownCard title="Por janela de minuto" rows={data.by_minute_window} />
        <BreakdownCard title="Top ligas" rows={data.by_league} />
      </div>

      {/* Horários */}
      <Card className="bg-[#0f172a] border-white/10 p-4">
        <h3 className="font-display text-lg text-white tracking-wider uppercase mb-3">Horários (BRT)</h3>
        <div className="grid grid-cols-6 md:grid-cols-12 gap-1">
          {Array.from({ length: 24 }).map((_, h) => {
            const row = data.by_hour.find((x) => x.hour_brt === h);
            const winrate = row ? wr(row.wins, row.total) : 0;
            const intensity = row && row.total > 0 ? Math.min(1, winrate / 80) : 0;
            const bg = row && row.total > 0
              ? `rgba(16, 185, 129, ${0.15 + intensity * 0.6})`
              : "rgba(255,255,255,0.03)";
            return (
              <div key={h}
                   className="aspect-square rounded flex flex-col items-center justify-center text-[10px]"
                   style={{ backgroundColor: bg }}
                   title={row ? `${winrate.toFixed(0)}% • ${row.total} sinais` : "sem dados"}>
                <div className="font-bold text-white">{h}h</div>
                {row && <div className="text-gray-300">{row.total}</div>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Diário */}
      <Card className="bg-[#0f172a] border-white/10 p-4">
        <h3 className="font-display text-lg text-white tracking-wider uppercase mb-3">Diário</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-gray-500 border-b border-white/10">
              <tr><th className="text-left py-2">Dia</th><th>Sinais</th><th>WR</th><th>ROI</th></tr>
            </thead>
            <tbody>
              {data.daily.map((d) => {
                const dwr = wr(d.wins, d.total);
                return (
                  <tr key={d.day} className="border-b border-white/5">
                    <td className="py-2 text-gray-300">{d.day}</td>
                    <td className="text-center text-gray-400">{d.total}</td>
                    <td className="text-center">{pctBadge(dwr)}</td>
                    <td className="text-center">{roiBadge(d.avg_roi)}</td>
                  </tr>
                );
              })}
              {data.daily.length === 0 && (
                <tr><td colSpan={4} className="text-center py-6 text-gray-500">Sem dados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <Card className="bg-[#0f172a] border-white/10 p-4">
      <h3 className="font-display text-lg text-white tracking-wider uppercase mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500">Sem dados</div>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 8).map((r) => {
            const rwr = wr(r.wins, r.total);
            const trend = r.avg_roi >= 0 ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />;
            return (
              <div key={r.subject} className="flex items-center justify-between gap-2 p-2 rounded bg-black/20">
                <div className="flex items-center gap-2 min-w-0">
                  {trend}
                  <span className="text-sm text-gray-200 truncate">{r.subject}</span>
                  <span className="text-[10px] text-gray-500">({r.total})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {pctBadge(rwr)}
                  {roiBadge(r.avg_roi)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
