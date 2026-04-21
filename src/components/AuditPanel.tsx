/**
 * PAINEL DE AUDITORIA — Debug de dados Live por partida
 * Mostra: stats recebidas da API, resultado isFake, validação, motivo de bloqueio
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Bug, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface AuditEntry {
  id: string | number;
  homeName: string;
  awayName: string;
  league: string;
  minute: number;
  homeGoals: number;
  awayGoals: number;
  // Raw stats from API
  rawHome: any;
  rawAway: any;
  // isFake results
  homeFake: boolean;
  awayFake: boolean;
  // After isFake filter
  filteredHome: any;
  filteredAway: any;
  // Validation
  dataStatus: string;
  statusMessage: string;
  // Analysis result
  scannerScore: number;
}

interface Props {
  entries: AuditEntry[];
}

const statusIcons: Record<string, React.ReactNode> = {
  valid: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  awaiting_api: <Clock className="w-3.5 h-3.5 text-yellow-400" />,
  awaiting_data: <Clock className="w-3.5 h-3.5 text-yellow-400" />,
  blocked: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  error: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
};

const statusColors: Record<string, string> = {
  valid: 'text-emerald-400',
  awaiting_api: 'text-yellow-400',
  awaiting_data: 'text-yellow-400',
  blocked: 'text-red-400',
  error: 'text-red-500',
};

function StatCell({ label, value }: { label: string; value: any }) {
  const display = value === null || value === undefined ? '—' : String(value);
  const isNull = value === null || value === undefined || value === 0;
  return (
    <div className="flex justify-between text-[9px] py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className={isNull ? 'text-gray-600' : 'text-gray-200 font-mono'}>{display}</span>
    </div>
  );
}

function MatchAuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-[#30363D] rounded-lg overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#0D1117] hover:bg-[#161B22] transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {statusIcons[entry.dataStatus] || statusIcons.error}
          <span className="text-[10px] font-bold text-gray-200 truncate">
            {entry.homeName} vs {entry.awayName}
          </span>
          <span className="text-[9px] text-gray-500 shrink-0">{entry.minute}'</span>
          <span className="text-[9px] text-gray-500 shrink-0">{entry.homeGoals}-{entry.awayGoals}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className={`text-[9px] font-bold uppercase ${statusColors[entry.dataStatus] || 'text-gray-400'}`}>
            {entry.dataStatus}
          </span>
          {open ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
        </div>
      </button>

      {/* Detail panel */}
      {open && (
        <div className="bg-[#161B22] border-t border-[#30363D] px-3 py-2 space-y-2">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-4 text-[9px]">
            <div className="flex justify-between py-0.5">
              <span className="text-gray-500">ID</span>
              <span className="text-gray-300 font-mono">{entry.id}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-gray-500">Liga</span>
              <span className="text-gray-300 truncate ml-2">{entry.league}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-gray-500">Score Scanner</span>
              <span className="text-orange-400 font-mono font-bold">{entry.scannerScore}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-gray-500">Status</span>
              <span className={`font-bold ${statusColors[entry.dataStatus]}`}>{entry.dataStatus}</span>
            </div>
          </div>

          {/* Status message */}
          {entry.statusMessage && (
            <div className="bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
              <span className="text-[9px] text-red-400 font-bold">⛔ {entry.statusMessage}</span>
            </div>
          )}

          {/* isFake results */}
          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded px-2 py-1 text-[9px] font-bold ${entry.homeFake ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
              🏠 Home isFake: {entry.homeFake ? 'TRUE ✗' : 'FALSE ✓'}
            </div>
            <div className={`rounded px-2 py-1 text-[9px] font-bold ${entry.awayFake ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
              ✈️ Away isFake: {entry.awayFake ? 'TRUE ✗' : 'FALSE ✓'}
            </div>
          </div>

          {/* Raw stats from API */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[8px] text-cyan-400 font-bold uppercase mb-1">Raw Home (API)</p>
              <div className="bg-[#0D1117] rounded p-2 border border-[#30363D]">
                {entry.rawHome ? (
                  <>
                    <StatCell label="Posse" value={entry.rawHome.possession} />
                    <StatCell label="Chutes" value={entry.rawHome.totalShots} />
                    <StatCell label="No Gol" value={entry.rawHome.shotsOnGoal} />
                    <StatCell label="At. Perigosos" value={entry.rawHome.dangerousAttacks} />
                    <StatCell label="Escanteios" value={entry.rawHome.corners} />
                  </>
                ) : (
                  <span className="text-[9px] text-red-400 font-bold">NULL — API não retornou</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-[8px] text-cyan-400 font-bold uppercase mb-1">Raw Away (API)</p>
              <div className="bg-[#0D1117] rounded p-2 border border-[#30363D]">
                {entry.rawAway ? (
                  <>
                    <StatCell label="Posse" value={entry.rawAway.possession} />
                    <StatCell label="Chutes" value={entry.rawAway.totalShots} />
                    <StatCell label="No Gol" value={entry.rawAway.shotsOnGoal} />
                    <StatCell label="At. Perigosos" value={entry.rawAway.dangerousAttacks} />
                    <StatCell label="Escanteios" value={entry.rawAway.corners} />
                  </>
                ) : (
                  <span className="text-[9px] text-red-400 font-bold">NULL — API não retornou</span>
                )}
              </div>
            </div>
          </div>

          {/* Filtered stats (after isFake) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[8px] text-orange-400 font-bold uppercase mb-1">Filtrado Home</p>
              <div className="bg-[#0D1117] rounded p-2 border border-[#30363D]">
                {entry.filteredHome ? (
                  <>
                    <StatCell label="Posse" value={entry.filteredHome.possession} />
                    <StatCell label="Chutes" value={entry.filteredHome.totalShots} />
                    <StatCell label="No Gol" value={entry.filteredHome.shotsOnGoal} />
                    <StatCell label="At. Perigosos" value={entry.filteredHome.dangerousAttacks} />
                    <StatCell label="Escanteios" value={entry.filteredHome.corners} />
                  </>
                ) : (
                  <span className="text-[9px] text-yellow-400 font-bold">NULL — Descartado por isFake</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-[8px] text-orange-400 font-bold uppercase mb-1">Filtrado Away</p>
              <div className="bg-[#0D1117] rounded p-2 border border-[#30363D]">
                {entry.filteredAway ? (
                  <>
                    <StatCell label="Posse" value={entry.filteredAway.possession} />
                    <StatCell label="Chutes" value={entry.filteredAway.totalShots} />
                    <StatCell label="No Gol" value={entry.filteredAway.shotsOnGoal} />
                    <StatCell label="At. Perigosos" value={entry.filteredAway.dangerousAttacks} />
                    <StatCell label="Escanteios" value={entry.filteredAway.corners} />
                  </>
                ) : (
                  <span className="text-[9px] text-yellow-400 font-bold">NULL — Descartado por isFake</span>
                )}
              </div>
            </div>
          </div>

          {/* Pipeline trace */}
          <div>
            <p className="text-[8px] text-purple-400 font-bold uppercase mb-1">Pipeline de Decisão</p>
            <div className="bg-[#0D1117] rounded p-2 border border-[#30363D] space-y-0.5 text-[9px] font-mono">
              <div className="flex items-center gap-1">
                {entry.rawHome || entry.rawAway
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                <span className="text-gray-400">1. API retornou stats?</span>
                <span className={entry.rawHome || entry.rawAway ? 'text-emerald-400' : 'text-red-400'}>
                  {entry.rawHome || entry.rawAway ? 'SIM' : 'NÃO'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {!entry.homeFake || !entry.awayFake
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                <span className="text-gray-400">2. Passou isFake?</span>
                <span className={!entry.homeFake || !entry.awayFake ? 'text-emerald-400' : 'text-red-400'}>
                  H:{entry.homeFake ? '✗' : '✓'} A:{entry.awayFake ? '✗' : '✓'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {entry.dataStatus === 'valid'
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                <span className="text-gray-400">3. validateLiveData?</span>
                <span className={entry.dataStatus === 'valid' ? 'text-emerald-400' : 'text-red-400'}>
                  {entry.dataStatus.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {entry.scannerScore > 0
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  : <XCircle className="w-3 h-3 text-gray-600 shrink-0" />}
                <span className="text-gray-400">4. Scanner Score</span>
                <span className={entry.scannerScore > 0 ? 'text-orange-400' : 'text-gray-600'}>
                  {entry.scannerScore}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const AuditPanel = ({ entries }: Props) => {
  const [expanded, setExpanded] = useState(false);

  const countByStatus = entries.reduce((acc, e) => {
    acc[e.dataStatus] = (acc[e.dataStatus] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Sort: valid first, then by minute desc
  const sorted = [...entries].sort((a, b) => {
    const statusOrder: Record<string, number> = { valid: 0, error: 1, blocked: 2, awaiting_data: 3, awaiting_api: 4 };
    const sa = statusOrder[a.dataStatus] ?? 5;
    const sb = statusOrder[b.dataStatus] ?? 5;
    if (sa !== sb) return sa - sb;
    return b.minute - a.minute;
  });

  return (
    <div className="bg-[#161B22] border border-purple-500/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1c2333] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">Auditoria Live</span>
          <span className="text-[10px] text-gray-500">({entries.length} jogos)</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[9px]">
            {countByStatus.valid && <span className="text-emerald-400">✅ {countByStatus.valid}</span>}
            {countByStatus.awaiting_api && <span className="text-yellow-400">⏳ {countByStatus.awaiting_api}</span>}
            {countByStatus.awaiting_data && <span className="text-yellow-400">📊 {countByStatus.awaiting_data}</span>}
            {countByStatus.blocked && <span className="text-red-400">🚫 {countByStatus.blocked}</span>}
            {countByStatus.error && <span className="text-red-500">❌ {countByStatus.error}</span>}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#30363D] px-3 py-3 space-y-2 max-h-[70vh] overflow-y-auto">
          {sorted.map((entry) => (
            <MatchAuditRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AuditPanel;
