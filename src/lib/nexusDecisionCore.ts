import type { MarketAnalysis, MatchData, CalibrationStatus, ProbabilitySource } from '@/types/match';
import { type DataQualityResult } from './dataQualityGate';
import type { ResearchEvidence } from './researchEvidence';
export type NexusDecision = 'SIGNAL' | 'CONSERVATIVE' | 'INFO_ONLY' | 'REJECT';
export type NexusMode = 'PRE_MATCH' | 'LIVE';
export type EvidenceSource = 'market' | 'engine' | 'live' | 'model' | 'research';
export interface NexusEvidence { source: EvidenceSource; name: string; value: number; weight?: number; supports?: boolean; }
export interface NexusDecisionInput { match: Pick<MatchData, 'id'|'homeTeam'|'awayTeam'|'league'|'isLive'|'status'|'minute'>; mode: NexusMode; confidence?: number|null; markets?: MarketAnalysis[]; evidence?: NexusEvidence[]; researchEvidence?: ResearchEvidence[]; analysisBlocked?: boolean; engineConflict?: boolean; dataQuality?: DataQualityResult|null; calibrationStatus?: CalibrationStatus|null; probabilitySource?: ProbabilitySource|null; }
export interface NexusDecisionOutput { decision: NexusDecision; confidence: number; riskScore: number; selectedMarket: MarketAnalysis|null; reasonCodes: string[]; evidenceScore: number; signalEligible: boolean; }
const clamp = (n:number,min=0,max=100) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const norm = (v:number|null|undefined) => typeof v === 'number' && Number.isFinite(v) ? clamp(v) : null;
const valid = (m:MarketAnalysis[]) => m.filter(x => Number.isFinite(x.probability) && x.probability >= 0 && x.probability <= 100);
const signalCalibration = (x:MarketAnalysis) => x.calibrationStatus === 'CALIBRATED' || x.calibrationStatus === 'MODEL_VALIDATED';
const signalCandidates = (m:MarketAnalysis[]) => valid(m).filter(x => x.probabilitySource === 'MODEL_ESTIMATE' && signalCalibration(x));
const score = (m:MarketAnalysis[]) => { const v=valid(m).map(x=>x.probability).sort((a,b)=>a-b); if(!v.length)return 0; const i=Math.floor(v.length/2); return v.length%2?v[i]:(v[i-1]+v[i])/2; };
const spread = (m:MarketAnalysis[]) => { const v=signalCandidates(m).map(x=>x.probability).sort((a,b)=>a-b); return v.length>=2?v[v.length-1]-v[0]:null; };
const evidence = (e:NexusEvidence[]) => { const u=e.map(x=>({v:clamp(x.value),w:Math.max(0,x.weight??1)})).filter(x=>x.w>0); if(!u.length)return 0; const t=u.reduce((s,x)=>s+x.w,0); return Math.round(u.reduce((s,x)=>s+x.v*x.w,0)/t); };
const researchScore = (e:ResearchEvidence[]) => { const valid=e.filter(x=>typeof x.claim==='string'&&x.claim.trim()&&Number.isFinite(x.confidence)); if(!valid.length)return 0; const weighted=valid.reduce((s,x)=>s+clamp(x.confidence)*(x.observed&&!x.estimated?1:0.5),0); const weights=valid.reduce((s,x)=>s+(x.observed&&!x.estimated?1:0.5),0); return weights?Math.round(weighted/weights):0; };
const selected = (m:MarketAnalysis[]) => valid(m).sort((a,b)=>b.probability-a.probability)[0] ?? null;

export function decideNexus(input:NexusDecisionInput):NexusDecisionOutput {
  const reasons:string[]=[]; const confidence=norm(input.confidence); const markets=input.markets??[]; const allSelected=selected(markets); const calibratedMarket=signalCandidates(markets).sort((a,b)=>b.probability-a.probability)[0] ?? null; const selectedMarket=calibratedMarket??allSelected; const best=score(markets); const sp=spread(markets); const ev=evidence(input.evidence??[]); const research=researchScore(input.researchEvidence??[]); const combinedEvidence=Math.round((ev+research)/((input.researchEvidence?.length??0)>0?2:1));
  const unverified=markets.some(m=>m.probabilitySource==='HEURISTIC'||m.probabilitySource==='UNKNOWN');
  const marketImplied=markets.some(m=>m.probabilitySource==='MARKET_IMPLIED');
  const source=input.probabilitySource??selectedMarket?.probabilitySource??null;
  const calibration=input.calibrationStatus??selectedMarket?.calibrationStatus??null;
  if(!input.match.id||!input.match.homeTeam||!input.match.awayTeam)return{decision:'REJECT',confidence:confidence??0,riskScore:100,selectedMarket:null,reasonCodes:['INVALID_MATCH'],evidenceScore:0,signalEligible:false};
  if(input.analysisBlocked)return{decision:'REJECT',confidence:confidence??0,riskScore:100,selectedMarket,reasonCodes:['ANALYSIS_BLOCKED'],evidenceScore:combinedEvidence,signalEligible:false};
  if(input.dataQuality?.status==='REJECT')return{decision:'REJECT',confidence:confidence??0,riskScore:100,selectedMarket,reasonCodes:[...input.dataQuality.reasons.map(r=>`DATA_${r}`),'DATA_QUALITY_REJECT'],evidenceScore:combinedEvidence,signalEligible:false};
  if(input.dataQuality?.status!=='VALID')reasons.push('DATA_QUALITY_NOT_VALID');
  if(input.dataQuality?.status==='DEGRADED')reasons.push(...input.dataQuality.reasons.map(r=>`DATA_${r}`),'DATA_QUALITY_DEGRADED');
  if(input.engineConflict)reasons.push('ENGINE_CONFLICT'); if(confidence===null)reasons.push('CONFIDENCE_MISSING'); if(confidence!==null&&confidence>95)reasons.push('CONFIDENCE_CAPPED');
  if(combinedEvidence<55)reasons.push('INSUFFICIENT_EVIDENCE'); if(!selectedMarket)reasons.push('NO_MARKET'); else if(best<72)reasons.push('MARKET_BELOW_THRESHOLD'); if(!calibratedMarket)reasons.push('NO_VALIDATED_MODEL_MARKET');
  if((input.researchEvidence?.length??0)>0&&research<55)reasons.push('RESEARCH_EVIDENCE_WEAK');
  if(sp!==null&&sp>15)reasons.push('MARKET_DISAGREEMENT'); if(unverified)reasons.push('PROBABILITY_UNVERIFIED'); if(marketImplied)reasons.push('MARKET_IMPLIED_NOT_MODEL_PROBABILITY'); if(source!=='MODEL_ESTIMATE')reasons.push('PROBABILITY_SOURCE_NOT_MODEL'); if(!(calibration==='CALIBRATED'||calibration==='MODEL_VALIDATED')) { reasons.push('PROBABILITY_NOT_VALIDATED'); if(calibration==='UNCALIBRATED'||calibration===null) reasons.push('PROBABILITY_NOT_CALIBRATED'); } if(input.mode==='LIVE'&&input.match.isLive!==true)reasons.push('LIVE_STATE_UNCONFIRMED');
  const safeConfidence = confidence === null ? 0 : Math.min(confidence,95);
  if(confidence===null)return{decision:'INFO_ONLY',confidence:0,riskScore:80,selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false};
  if(confidence<50||combinedEvidence<55||!selectedMarket)return{decision:'REJECT',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,combinedEvidence)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false};
  if(confidence<70||best<72)return{decision:'INFO_ONLY',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,best)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false};
  if(input.mode==='LIVE'&&input.match.isLive!==true)return{decision:'CONSERVATIVE',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,best,combinedEvidence)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false};
  if(input.dataQuality?.status!=='VALID'||unverified||marketImplied||source!=='MODEL_ESTIMATE'||!(calibration==='CALIBRATED'||calibration==='MODEL_VALIDATED')||!calibratedMarket)return{decision:'CONSERVATIVE',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,best,combinedEvidence,input.dataQuality?.score??0)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false};
  if(input.engineConflict||(sp!==null&&sp>15)){return{decision:'CONSERVATIVE',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,best,combinedEvidence,input.dataQuality?.score??0)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false};}
  if(confidence<85){reasons.push('CONSERVATIVE_CONFIDENCE');return{decision:'CONSERVATIVE',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,best,combinedEvidence)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false};}
  if(!selectedMarket.odd || !Number.isFinite(selectedMarket.odd) || selectedMarket.odd <= 1){ reasons.push('MARKET_ODD_MISSING'); return {decision:'CONSERVATIVE',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,best,combinedEvidence)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:false}; }
  reasons.push('CORE_APPROVED_SIGNAL'); return{decision:'SIGNAL',confidence:safeConfidence,riskScore:clamp(100-Math.min(safeConfidence,best,combinedEvidence)),selectedMarket,reasonCodes:reasons,evidenceScore:combinedEvidence,signalEligible:true};
}
export function marketsToNexusEvidence(markets:MarketAnalysis[]):NexusEvidence[]{return markets.filter(m=>Number.isFinite(m.probability)).map(m=>({source:'market',name:m.market,value:clamp(m.probability),weight:1}));}
export function researchToNexusEvidence(items:ResearchEvidence[]):NexusEvidence[]{return items.filter(x=>x.observed&&!x.estimated).map(x=>({source:'research',name:x.type,value:clamp(x.confidence),weight:x.sourceType==='MARKET'?1:0.75,supports:true}));}
