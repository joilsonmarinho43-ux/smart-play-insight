import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CandlestickChart, Clock3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Market = 'WIN' | 'WDO' | 'NASDAQ' | 'OURO';
type Decision = 'CANDIDATA' | 'AGUARDAR' | 'SEM_ENTRADA';
type Snapshot = {
  market: Market;
  instrument: string;
  source: string;
  bar_end: string;
  decision: Decision;
  reason?: string;
  direction?: 'COMPRA' | 'VENDA';
  reference_entry?: number;
  stop?: number;
  target?: number;
  risk_points?: number;
  reward_risk?: number;
};

const MARKETS: { id: Market; title: string }[] = [
  { id: 'WIN', title: 'Mini Índice' },
  { id: 'WDO', title: 'Mini Dólar' },
  { id: 'NASDAQ', title: 'Nasdaq' },
  { id: 'OURO', title: 'Ouro' },
];

const endpoint = import.meta.env.VITE_TRADER_ANALYSIS_URL?.trim();
const MAX_AGE_MS = 25_000;

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const validMarket = MARKETS.some(({ id }) => id === data.market);
  return validMarket && typeof data.instrument === 'string' && !!data.instrument
    && typeof data.source === 'string' && !!data.source
    && typeof data.bar_end === 'string' && Number.isFinite(Date.parse(data.bar_end))
    && ['CANDIDATA', 'AGUARDAR', 'SEM_ENTRADA'].includes(String(data.decision));
}

function safeSnapshot(snapshot: Snapshot | undefined, now: number): Snapshot | undefined {
  if (!snapshot) return undefined;
  const age = now - Date.parse(snapshot.bar_end);
  if (age < -5000 || age > MAX_AGE_MS) return undefined;
  if (snapshot.decision !== 'CANDIDATA') return snapshot;
  const prices = [snapshot.reference_entry, snapshot.stop, snapshot.target, snapshot.risk_points];
  if (!prices.every(price => typeof price === 'number' && Number.isFinite(price) && price > 0)) return undefined;
  if (snapshot.direction === 'COMPRA' && snapshot.stop! < snapshot.reference_entry! && snapshot.target! > snapshot.reference_entry!) return snapshot;
  if (snapshot.direction === 'VENDA' && snapshot.stop! > snapshot.reference_entry! && snapshot.target! < snapshot.reference_entry!) return snapshot;
  return undefined;
}

function MarketCard({ id, title, snapshot, now }: { id: Market; title: string; snapshot?: Snapshot; now: number }) {
  const current = safeSnapshot(snapshot, now);
  const time = current ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(current.bar_end)) : null;
  return <section className="rounded-xl border border-white/10 bg-[#111c30] p-5" aria-label={title}>
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs text-gray-400">{id}</p><h2 className="text-lg font-semibold text-white">{title}</h2></div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${current?.decision === 'CANDIDATA' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
        {current?.decision === 'CANDIDATA' ? `${current.direction} candidata` : current?.decision === 'AGUARDAR' ? 'Aguardar' : 'Sem entrada'}
      </span>
    </div>
    {current ? <>
      <p className="mt-4 text-sm text-gray-300">{current.reason || (current.decision === 'CANDIDATA' ? 'Confluências e gatilho detectados' : 'Nenhum gatilho válido')}</p>
      {current.decision === 'CANDIDATA' && <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>Entrada de referência <strong className="block text-white">{current.reference_entry}</strong></div>
        <div>Stop <strong className="block text-white">{current.stop}</strong></div>
        <div>Alvo <strong className="block text-white">{current.target}</strong></div>
        <div>Risco em pontos <strong className="block text-white">{current.risk_points}</strong></div>
      </div>}
      <p className="mt-4 flex items-center gap-2 text-xs text-gray-400"><Clock3 className="h-3 w-3" />{time} (Brasília) · {current.instrument} · {current.source}</p>
    </> : <p className="mt-5 flex items-center gap-2 text-sm text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />Sem cotação atual verificada. Nenhuma entrada disponível.</p>}
  </section>;
}

export default function TraderMarkets() {
  const [snapshots, setSnapshots] = useState<Partial<Record<Market, Snapshot>>>({});
  const [now, setNow] = useState(Date.now());
  const [connection, setConnection] = useState(endpoint ? 'Aguardando dados' : 'Feed independente ainda não configurado');

  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    const controller = new AbortController();
    const update = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('sessão ausente');
        const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store',
          headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!response.ok) throw new Error('feed indisponível');
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error('formato inválido');
        const next: Partial<Record<Market, Snapshot>> = {};
        payload.filter(isSnapshot).forEach(item => { next[item.market] = item; });
        if (active) { setSnapshots(next); setConnection('Fonte conectada'); }
      } catch {
        if (active) { setSnapshots({}); setConnection('Feed indisponível'); }
      }
    };
    void update();
    const poll = window.setInterval(() => { void update(); }, 15_000);
    return () => { active = false; controller.abort(); window.clearInterval(poll); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 text-white sm:px-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="flex items-center gap-2 text-xs uppercase tracking-widest text-orange-300"><CandlestickChart className="h-4 w-4" /> Mercado financeiro</p>
        <h1 className="mt-2 text-2xl font-bold">Agente Trader</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-400">Leitura independente dos quatro mercados. Candidatas são cenários para avaliação; nenhuma ordem é enviada.</p></div>
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300"><Activity className="h-4 w-4" />{connection}</div>
    </div>
    <div className="grid gap-4 md:grid-cols-2">{MARKETS.map(market => <MarketCard key={market.id} {...market} snapshot={snapshots[market.id]} now={now} />)}</div>
    <p className="text-xs text-gray-500">Sinais só aparecem com fonte identificada e cotação recente. A análise financeira não usa dados ou sinais esportivos do NEXUS 33.</p>
  </div>;
}
