import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crosshair, Loader2 } from 'lucide-react';
import { fetchMultiDayMatches } from '@/services/footballApi';
import { isWorldCupLeague } from '@/lib/worldCupLeagues';
import { localizeTeamName } from '@/lib/teamI18n';
import { useScannerEnrichment } from '@/hooks/useScannerEnrichment';
import { recordNexusPreMatchPrediction } from '@/lib/nexusPredictionRecorder';
import ScannerProPanel from '@/components/ScannerProPanel';
import bgPattern from '@/assets/bg-circuit-pattern.jpg';

function hasRealData(match: any): boolean {
  const md = match?.modelData || {};
  const sample = match?.sampleSize || {};
  return Number(sample.homeGames ?? 0) >= 3 &&
    Number(sample.awayGames ?? 0) >= 3 &&
    Number(md.homeGoalsAvg ?? 0) > 0 &&
    Number(md.awayGoalsAvg ?? 0) > 0;
}

const Scanner = () => {
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['matches-multiday'],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const safeMatches = useMemo(() => (matches || [])
    .filter((m: any) => !isWorldCupLeague(m.league))
    .map((m: any) => ({
      ...m,
      homeTeam: localizeTeamName(m.teams?.home?.name || m.homeTeam) || 'Casa',
      awayTeam: localizeTeamName(m.teams?.away?.name || m.awayTeam) || 'Fora',
      league: m.league?.name || m.league || '',
      kickoff: m.fixture?.date || m.kickoff || m.date || m.utcDate || m.time || null,
      time: m.fixture?.date
        ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(m.fixture.date))
        : m.time || '',
    })), [matches]);

  const { matches: enrichedMatches, isEnriching, enrichedCount } = useScannerEnrichment(safeMatches);
  const recordedIds = useRef(new Set<string>());
  const [ledgerStatus, setLedgerStatus] = useState<{
    running: boolean;
    total: number;
    processed: number;
    recorded: number;
    skipped: number;
    rejected: number;
    lastReason: string;
  }>({
    running: false,
    total: 0,
    processed: 0,
    recorded: 0,
    skipped: 0,
    rejected: 0,
    lastReason: '',
  });

  useEffect(() => {
    if (isEnriching || enrichedMatches.length === 0) return;

    const candidates = enrichedMatches.filter(match => {
      const id = String(match.id ?? '');
      return !match.isLive && Boolean(id) && !recordedIds.current.has(id);
    });
    if (candidates.length === 0) return;

    candidates.forEach(match => recordedIds.current.add(String(match.id)));
    let cancelled = false;
    setLedgerStatus(prev => ({
      ...prev,
      running: true,
      total: candidates.length,
      processed: 0,
      recorded: 0,
      skipped: 0,
      rejected: 0,
      lastReason: '',
    }));

    void Promise.allSettled(
      candidates.map(async match => {
        try {
          const result = await recordNexusPreMatchPrediction(match);
          console.info(`[NEXUS-LEDGER] ${String(match.homeTeam)} vs ${String(match.awayTeam)} → ${result.reason}`);
          return result;
        } catch (error) {
          console.error('[NEXUS-LEDGER] recorder task failed:', error);
          throw error;
        }
      }),
    ).then(results => {
      if (cancelled) return;

      const failures = results.filter(result => result.status === 'rejected');
      const recorded = results.filter(result => result.status === 'fulfilled' && result.value.recorded).length;
      const skipped = results.filter(result => result.status === 'fulfilled' && !result.value.recorded).length;
      const lastRejected = [...results].reverse().find(result => result.status === 'fulfilled' && !result.value.recorded);
      const lastReason = lastRejected && lastRejected.status === 'fulfilled'
        ? lastRejected.value.reason
        : failures.length > 0 ? 'RECORDER_TASK_REJECTED' : recorded > 0 ? 'RECORDED' : 'NONE';

      console.info(`[NEXUS-LEDGER] scan complete: recorded=${recorded} skipped=${skipped} rejected=${failures.length}`);
      setLedgerStatus({ running: false, total: candidates.length, processed: results.length, recorded, skipped, rejected: failures.length, lastReason });
    });

    return () => { cancelled = true; };
  }, [enrichedMatches, isEnriching]);

  const candidateCount = enrichedMatches.filter(match => !match.isLive && Boolean(match.id)).length;
  const realDataCount = enrichedMatches.filter(hasRealData).length;

  return (
    <div className="min-h-screen text-white pb-8 font-sans relative">
      <div className="fixed inset-0 z-0" style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div className="fixed inset-0 z-0 bg-black/50" />

      <main className="container max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 pt-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Link to="/" className="p-2 bg-black/30 rounded-lg hover:bg-black/50"><ArrowLeft className="w-4 h-4" /></Link>
          <Crosshair className="w-6 h-6 text-orange-500" />
          <h1 className="text-xl font-black uppercase tracking-wider">Scanner PRO</h1>
          {isEnriching && <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-[11px] text-orange-300"><Loader2 className="w-3 h-3 animate-spin text-orange-400" /><span>Calibrando histórico real...</span></div>}
        </div>

        <div className="mb-4 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white/80">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Ledger: {ledgerStatus.running ? 'processando…' : 'aguardando/Processado'}</span>
            <span>Partidas: {safeMatches.length}</span>
            <span>Enriquecidas: {enrichedCount}</span>
            <span>Dados reais: {realDataCount}</span>
            <span>Candidatas: {candidateCount}</span>
            <span>Processadas: {ledgerStatus.processed}/{ledgerStatus.total}</span>
            <span>Registrados: {ledgerStatus.recorded}</span>
            <span>Ignorados: {ledgerStatus.skipped}</span>
            <span>Erros: {ledgerStatus.rejected}</span>
          </div>
          {!ledgerStatus.running && (
            <div className="mt-1 break-all text-white/60">
              Último diagnóstico: {ledgerStatus.lastReason || (candidateCount === 0 ? 'NO_PRE_MATCH_CANDIDATES' : 'AGUARDANDO_RESULTADO')}
            </div>
          )}
        </div>

        {isLoading ? <p className="text-center text-muted-foreground py-8">Carregando jogos...</p> : <ScannerProPanel matches={enrichedMatches} />}
      </main>
    </div>
  );
};

export default Scanner;
