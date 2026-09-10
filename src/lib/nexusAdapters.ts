import type { MarketAnalysis, MatchData, CalibrationStatus } from '@/types/match';
import { decideNexus, marketsToNexusEvidence, type NexusDecisionOutput, type NexusEvidence, type NexusMode } from '@/lib/nexusDecisionCore';
import { assessDataQuality } from '@/lib/dataQualityGate';

/** Compatibility adapter for legacy live payloads. Heuristic live pressure is never a calibrated probability. */
export interface LegacyLiveSignal {
  matchId: string; match: string; league: string; minute: number; pressure: number;
  shotsOnGoal: number; corners: number; possession: number; dangerousAttacks: number;
  observedAt?: string | null; daEstimated?: boolean; signalEligible?: boolean; tier?: string; confidence?: string;
}
function liveEvidence(signal: LegacyLiveSignal): NexusEvidence[] {
  const weight = signal.daEstimated ? 0.75 : 1;
  return [
    { source:'live', name:'pressure_observed', value:signal.pressure, weight },
    { source:'live', name:'shots_on_goal', value:signal.shotsOnGoal*10, weight },
    { source:'live', name:'corners', value:signal.corners*10, weight },
    { source:'live', name:'possession', value:signal.possession, weight },
    { source:'live', name:'dangerous_attacks', value:Math.min(100,signal.dangerousAttacks*5), weight },
  ];
}
export function adaptHybridSignal(signal: LegacyLiveSignal, market?: MarketAnalysis): NexusDecisionOutput {
  const match:Pick<MatchData,'id'|'homeTeam'|'awayTeam'|'league'|'isLive'|'status'|'minute'>={id:signal.matchId,homeTeam:signal.match.split(' vs ')[0]||signal.match,awayTeam:signal.match.split(' vs ')[1]||'',league:signal.league,isLive:true,status:'LIVE',minute:signal.minute};
  const markets=market?[{...market,probabilitySource:'HEURISTIC' as const,calibrationStatus:'UNCALIBRATED' as const}]:[];
  const dataQuality=assessDataQuality({live:true,observedAt:signal.observedAt??null,estimatedData:signal.daEstimated});
  return decideNexus({match,mode:'LIVE' satisfies NexusMode,confidence:signal.confidence==='alta'?90:signal.confidence==='média'?75:null,markets,evidence:[...liveEvidence(signal),...marketsToNexusEvidence(markets)],analysisBlocked:signal.signalEligible===false,engineConflict:true,dataQuality});
}
export function adaptPreMatch(match:MatchData,markets:MarketAnalysis[],confidence:number|null|undefined,calibrationStatus:CalibrationStatus='UNCALIBRATED'):NexusDecisionOutput {
  const normalizedMarkets=markets.map(m=>({...m,probabilitySource:m.probabilitySource??'MODEL_ESTIMATE' as const,calibrationStatus:m.calibrationStatus??calibrationStatus}));
  const sampleSize=match.sampleSize?Math.min(match.sampleSize.homeGames,match.sampleSize.awayGames):null;
  const dataQuality=assessDataQuality({live:false,sampleSize,requiredSampleSize:3,sourceCompleteness:match.modelData&&match.sampleSize?100:75,requiredFeaturesPresent:normalizedMarkets.length>0});
  return decideNexus({match,mode:'PRE_MATCH',confidence,markets:normalizedMarkets,evidence:marketsToNexusEvidence(normalizedMarkets),dataQuality,calibrationStatus,probabilitySource:'MODEL_ESTIMATE'});
}
