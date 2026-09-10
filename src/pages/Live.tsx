import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { fetchLiveMatches } from '@/services/footballApi';
import type { MatchData } from '@/types/match';

function Side({ name, value }: { name: string; value: number | undefined }) {
  return <div className="rounded-lg bg-secondary/30 p-2 text-xs"><div className="truncate text-muted-foreground">{name}</div><div className="mt-1 font-bold tabular-nums">{Number.isFinite(value) ? value : '—'}</div></div>;
}

export default function Live() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['nexus-live-matches'], queryFn: fetchLiveMatches, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false });
  const matches = (data || []) as MatchData[];

  return <main className="min-h-screen p-4 sm:p-6"><div className="mx-auto max-w-6xl">
    <header className="mb-6 flex items-center justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Nexus 33 · Monitoramento</p><h1 className="mt-1 text-2xl font-bold">Partidas ao vivo</h1><p className="mt-1 text-sm text-muted-foreground">Somente observação de dados reais. Não há execução de ordens.</p></div><button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar</button></header>
    {error && <div className="mb-5 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /> Fonte ao vivo indisponível.</div>}
    {isLoading ? <p className="py-16 text-center text-sm text-muted-foreground">Carregando dados ao vivo…</p> : matches.length === 0 ? <div className="rounded-2xl border border-border/50 bg-card p-8 text-center text-sm text-muted-foreground">Nenhuma partida ao vivo disponível com dados reais neste momento.</div> : <div className="grid gap-4 md:grid-cols-2">{matches.map((match) => { const ls = match.liveStats; return <article key={match.id} className="rounded-2xl border border-border/50 bg-card p-4"><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>{match.league}</span><span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {match.minute != null ? `${match.minute}'` : match.time}</span></div><div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><b className="text-right text-sm">{match.homeTeam}</b><span className="rounded-lg bg-secondary px-3 py-1 text-xs font-bold">{match.liveScore ? `${match.liveScore.home}–${match.liveScore.away}` : '—'}</span><b className="text-sm">{match.awayTeam}</b></div>{ls ? <div className="mt-4 grid grid-cols-2 gap-2"><Side name="Ataques perigosos · casa" value={ls.dangerousAttacks?.[0]} /><Side name="Ataques perigosos · fora" value={ls.dangerousAttacks?.[1]} /><Side name="Escanteios · casa" value={ls.corners?.[0]} /><Side name="Escanteios · fora" value={ls.corners?.[1]} /><Side name="Posse · casa" value={ls.possession?.[0]} /><Side name="Posse · fora" value={ls.possession?.[1]} /><Side name="Pressão observada · casa" value={ls.pressureIndex?.[0]} /><Side name="Pressão observada · fora" value={ls.pressureIndex?.[1]} /></div> : <p className="mt-4 text-xs text-muted-foreground">Estatísticas ao vivo ainda não disponíveis.</p>}<p className="mt-4 text-[10px] text-muted-foreground">Índices de pressão são indicadores observacionais/heurísticos; não são probabilidade nem sinal oficial.</p></article>; })}</div>}
  </div></main>;
}
