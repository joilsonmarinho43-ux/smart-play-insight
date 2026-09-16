import { supabase } from '@/integrations/supabase/client';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { adaptPreMatch } from '@/lib/nexusAdapters';
import { assessDataQuality } from '@/lib/dataQualityGate';
import { buildLedgerPrediction } from '@/lib/predictionLedgerPersistence';
import { resolveConfidence } from '@/lib/confidencePolicy';
import { buildMatchReadingV2 } from '@/lib/readingEngine';
import type { MatchData, MarketAnalysis } from '@/types/match';

const MODEL_VERSION = 'poisson-xg-bayes-v2-red-hardening';

function observedOddForMarket(market:string, odds:any):number|null{
  if(!odds)return null;
  const map:Record<string,number|null>={
    'Vitória Casa':odds.home,'Empate':odds.draw,'Vitória Fora':odds.away,
    'Over 0.5 Gols':odds.over05,'Over 1.5 Gols':odds.over15,'Over 2.5 Gols':odds.over25,'Over 3.5 Gols':odds.over35,
    'Under 2.5 Gols':odds.under25,'Ambas Marcam':odds.bttsYes,'Over 6.5 Cantos':odds.over65Corners,'Over 3.5 Cartões':odds.over35Cards,
  };
  const v=map[market]; return typeof v==='number'&&Number.isFinite(v)&&v>1?v:null;
}

async function enrichHistoricalModel(match:MatchData):Promise<MatchData>{
  try{
    const {data,error}=await supabase.functions.invoke('team-form',{body:{home:match.homeTeam,away:match.awayTeam}});
    if(error||!data?.ok)return match;
    const h=data.home||{},a=data.away||{};const homeGames=Number(h.games??0),awayGames=Number(a.games??0),hGF=Number(h.goalsForAvg),aGF=Number(a.goalsForAvg),hGA=Number(h.goalsAgainstAvg),aGA=Number(a.goalsAgainstAvg);
    if(![homeGames,awayGames,hGF,aGF,hGA,aGA].every(Number.isFinite)||homeGames<3||awayGames<3)return match;
    const sample=Math.min(homeGames,awayGames);
    const modelData={...(match.modelData||{}),homeGoalsAvg:hGF,awayGoalsAvg:aGF,homeGoalsAgainstAvg:hGA,awayGoalsAgainstAvg:aGA,leagueAvg:match.modelData?.leagueAvg??2.5,source:'team-form:ESPN/TSDB',historicalSample:sample,dataQuality:sample>=5?'VALID':'PARTIAL'} as MatchData['modelData'];
    return {...match,modelData,sampleSize:{homeGames,awayGames,homeWithStats:homeGames,awayWithStats:awayGames},homeStats:{goalsFor:hGF,goalsAgainst:hGA,gamesCount:homeGames,leagueAvg:modelData.leagueAvg},awayStats:{goalsFor:aGF,goalsAgainst:aGA,gamesCount:awayGames,leagueAvg:modelData.leagueAvg}} as MatchData;
  }catch{return match;}
}

async function loadPreMatchContext(match:MatchData){
  const m:any=match; const fixtureId=m.fixture?.id||match.id; try{const {data,error}=await supabase.functions.invoke('match-context',{body:{fixtureId,leagueId:m.league?.id||m.leagueId,season:m.league?.season||m.season,homeId:m.teams?.home?.id||m.homeId,awayId:m.teams?.away?.id||m.awayId,homeName:match.homeTeam,awayName:match.awayTeam,kickoffISO:m.fixture?.date||match.kickoff}});return error?null:data||null;}catch{return null;}
}
async function runPreMatchAiAudit(match:MatchData,reading:any,context:any){try{const {data,error}=await supabase.functions.invoke('match-analyst',{body:{match:{id:match.id,homeTeam:match.homeTeam,awayTeam:match.awayTeam,league:match.league,time:match.time,status:match.status,minute:match.minute},reading,context,pesquisaWeb:true}});if(error||!data)return{status:'CAUTION',reasons:['AI_AUDIT_UNAVAILABLE']};return data.aiAudit||{status:'CAUTION',reasons:['AI_AUDIT_MISSING']};}catch{return{status:'CAUTION',reasons:['AI_AUDIT_ERROR']};}}

export async function recordNexusPreMatchPrediction(match: MatchData): Promise<{recorded:boolean;reason:string}> {
  if(!match.id||match.isLive)return{recorded:false,reason:'NOT_PRE_MATCH'};
  try{
    const enrichedMatch=await enrichHistoricalModel(match);
    const confidence=await resolveConfidence({matchId:String(enrichedMatch.id),homeTeam:enrichedMatch.homeTeam,awayTeam:enrichedMatch.awayTeam,league:enrichedMatch.league,kickoffISO:enrichedMatch.kickoff??enrichedMatch.time});
    if(!Number.isFinite(confidence.score)||confidence.score<85)return{recorded:false,reason:`CONFIDENCE_BELOW_SIGNAL_THRESHOLD:${Number.isFinite(confidence.score)?confidence.score:'invalid'}:${confidence.source}:${confidence.diagnostic??'NONE'}`};
    const context=await loadPreMatchContext(enrichedMatch);
    const reading=buildMatchReadingV2(enrichedMatch,context);
    const aiAudit=await runPreMatchAiAudit(enrichedMatch,reading,context);
    if(aiAudit.status==='BLOCK')return{recorded:false,reason:`AI_PREMATCH_BLOCK:${(aiAudit.reasons||[]).join('|')||'UNSPECIFIED'}`};
    let markets=analyzeMarkets(enrichedMatch); if(!markets.length)return{recorded:false,reason:'NO_MARKETS'};
    const odds=context?.odds??null; markets=markets.map((m:MarketAnalysis)=>({...m,odd:observedOddForMarket(m.market,odds)}));
    const decision=adaptPreMatch(enrichedMatch,markets,confidence.score,enrichedMatch.predictions?.calibrationStatus);
    const sampleSize=enrichedMatch.sampleSize?Math.min(enrichedMatch.sampleSize.homeGames,enrichedMatch.sampleSize.awayGames):null;
    const modelDataValid=Boolean(enrichedMatch.modelData&&sampleSize!==null&&sampleSize>=3&&Number.isFinite(enrichedMatch.modelData.homeGoalsAvg)&&Number.isFinite(enrichedMatch.modelData.awayGoalsAvg)&&Number.isFinite(enrichedMatch.modelData.homeGoalsAgainstAvg)&&Number.isFinite(enrichedMatch.modelData.awayGoalsAgainstAvg));
    const quality=assessDataQuality({live:false,sampleSize,requiredSampleSize:3,sourceCompleteness:modelDataValid?100:75,requiredFeaturesPresent:markets.length>0});
    if(decision.decision!=='SIGNAL'||!decision.selectedMarket){const codes=decision.reasonCodes.length?decision.reasonCodes.join('|'):'NONE';return{recorded:false,reason:`CORE_${decision.decision}:selected=${decision.selectedMarket?.market??'NONE'}:codes=${codes}:quality=${quality.status}:${quality.score}:ai=${aiAudit.status}`};}
    const ledgerRecord=buildLedgerPrediction({predictionId:`nexus:${String(enrichedMatch.id)}:${decision.selectedMarket.market}`,matchId:String(enrichedMatch.id),decision,market:decision.selectedMarket,modelVersion:MODEL_VERSION,dataQualityScore:quality.score,dataQualityStatus:quality.status,predictedAt:new Date().toISOString(),dataObservedAt:new Date().toISOString()});
    if(!ledgerRecord)return{recorded:false,reason:`LEDGER_GATE_REJECTED:source=${decision.selectedMarket.probabilitySource??'UNKNOWN'}:quality=${quality.status}:${quality.score}:codes=${decision.reasonCodes.join('|')||'NONE'}`};
    const {data:userData}=await supabase.auth.getUser();const userId=userData.user?.id;if(!userId)return{recorded:false,reason:'AUTH_REQUIRED'};
    const {error}=await (supabase.from as any)('prediction_ledger').insert({prediction_id:ledgerRecord.predictionId,user_id:userId,match_id:ledgerRecord.matchId,market:ledgerRecord.market,probability:ledgerRecord.probability,confidence:ledgerRecord.confidence,model_version:ledgerRecord.modelVersion,mode:ledgerRecord.mode,probability_source:ledgerRecord.probabilitySource,calibration_status:ledgerRecord.calibrationStatus,market_odd:ledgerRecord.marketOdd,predicted_at:ledgerRecord.predictedAt,data_observed_at:ledgerRecord.dataObservedAt,data_quality_score:ledgerRecord.dataQualityScore,data_quality_status:ledgerRecord.dataQualityStatus});
    if(error){if(error.code==='23505')return{recorded:false,reason:'ALREADY_RECORDED'};return{recorded:false,reason:`PERSISTENCE_ERROR:${error.code||'UNKNOWN'}`};}
    const {data:tg,error:tgError}=await supabase.functions.invoke('telegram-signal',{body:{predictionId:ledgerRecord.predictionId,match:{id:enrichedMatch.id,homeTeam:enrichedMatch.homeTeam,awayTeam:enrichedMatch.awayTeam,league:enrichedMatch.league},market:decision.selectedMarket.market,marketType:decision.selectedMarket.category,probability:decision.selectedMarket.probability,confidence:decision.confidence,odd:decision.selectedMarket.odd,oddSource:decision.selectedMarket.odd?'OBSERVED':'UNKNOWN',calibrationStatus:decision.selectedMarket.calibrationStatus,probabilitySource:decision.selectedMarket.probabilitySource,decision:{decision:decision.decision,signalEligible:decision.signalEligible,reasonCodes:decision.reasonCodes},aiAudit}});
    if(tgError||tg?.disabled)return{recorded:true,reason:`RECORDED_TELEGRAM_NOT_SENT:${tg?.reason||tgError?.message||'disabled'}`};
    return{recorded:true,reason:'RECORDED_AND_TELEGRAM_SENT'};
  }catch(error){console.error('[NEXUS-LEDGER] recorder failed:',error);return{recorded:false,reason:`RECORDER_ERROR:${error instanceof Error?error.message:'UNKNOWN'}`};}
}
