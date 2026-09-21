import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MatchData } from "@/types/match";
import { mergeFormIntoMatch } from "@/hooks/useTeamForm";
import { buildMatchReadingV2, type MatchContext, type MatchReadingV2 } from "@/lib/readingEngine";
import { fetchResearchContext, getResearchGapFields } from "@/lib/researchContextClient";
import type { ResearchEvidence } from "@/lib/researchEvidence";

export interface AnalystReading { cenario: string; pontoAtencao: string; veredito: string; risco: "baixo" | "medio" | "alto"; aiAudit?: { status: "PASS" | "CAUTION" | "BLOCK"; reasons: string[]; evidenceQuality: "alta" | "media" | "baixa"; source: string }; contextoDetalhado?: { desfalques?: string; arbitro?: string; clima?: string; motivacao?: string }; mercados?: { vitoria?: string; duplaChance?: string; handicap?: string; overUnderGols?: string; btts?: string; escanteios?: string; cartoes?: string; placarExato?: string }; oddsReferencia?: { casa?: string; empate?: string; fora?: string; over25?: string; under25?: string; bttsSim?: string; escanteiosOver9?: string; cartoesOver4?: string }; }
export interface FallbackStats { stats: Record<string, any>; source: string; confidence_score: number; lowConfidence: boolean; missing: string[]; }
interface State { loading: boolean; reading: MatchReadingV2 | null; context: MatchContext | null; error: string | null; analyst: AnalystReading | null; analystLoading: boolean; analystError: "rate_limited" | "credits_exhausted" | "ai_error" | "parse_fail" | null; fallback: FallbackStats | null; }
const memCache = new Map<string, { ts: number; ctx: MatchContext }>(); const analystCache = new Map<string, { ts: number; data: AnalystReading }>(); const fallbackCache = new Map<string, { ts: number; data: FallbackStats }>(); const researchCache = new Map<string, { ts: number; evidence: ResearchEvidence[] }>(); const quantCache = new Map<string, { ts: number; match: MatchData }>();
const TTL = 8 * 60 * 1000, ANALYST_TTL = 30 * 60 * 1000, FALLBACK_TTL = 60 * 60 * 1000, RESEARCH_TTL = 20 * 60 * 1000, QUANT_TTL = 6 * 60 * 60 * 1000;

async function enrichQuantitativeData(match: MatchData): Promise<MatchData> {
  const md = match.modelData as any;
  const sample = match.sampleSize;
  const readyFromCurrentMatch =
    Number(sample?.homeGames || 0) >= 3 &&
    Number(sample?.awayGames || 0) >= 3 &&
    [md?.homeGoalsAvg, md?.awayGoalsAvg, md?.homeGoalsAgainstAvg, md?.awayGoalsAgainstAvg]
      .every((v: unknown) => Number.isFinite(Number(v)));
  if (readyFromCurrentMatch) return match;

  const key = `${match.homeTeam}|${match.awayTeam}`; const cached = quantCache.get(key); if (cached && Date.now() - cached.ts < QUANT_TTL) return cached.match;
  try {
    const { data, error } = await supabase.functions.invoke("team-form", { body: { home: match.homeTeam, away: match.awayTeam } }); if (error || !data?.ok) return match;
    const home = data.home || {}, away = data.away || {}; const homeGames = Number(home.games ?? 0), awayGames = Number(away.games ?? 0); const homeGF = Number(home.goalsForAvg), awayGF = Number(away.goalsForAvg), homeGA = Number(home.goalsAgainstAvg), awayGA = Number(away.goalsAgainstAvg);
    if (![homeGames, awayGames, homeGF, awayGF, homeGA, awayGA].every(Number.isFinite) || homeGames < 3 || awayGames < 3) return match;
    const sample = Math.min(homeGames, awayGames);
    const merged = mergeFormIntoMatch(match, { ok: true, home, away } as any);
    const modelData = {
      ...(merged.modelData || {}),
      homeGoalsAvg: homeGF,
      awayGoalsAvg: awayGF,
      homeGoalsAgainstAvg: homeGA,
      awayGoalsAgainstAvg: awayGA,
      leagueAvg: merged.modelData?.leagueAvg ?? 2.5,
      source: "team-form:ESPN/TSDB",
      historicalSample: sample,
      dataQuality: sample >= 5 ? "VALID" : "PARTIAL",
    } as MatchData["modelData"];
    const enriched: MatchData = {
      ...merged,
      modelData,
      sampleSize: {
        ...(merged.sampleSize || {}),
        homeGames: Math.max(Number(merged.sampleSize?.homeGames || 0), homeGames),
        awayGames: Math.max(Number(merged.sampleSize?.awayGames || 0), awayGames),
        homeWithStats: Math.max(Number(merged.sampleSize?.homeWithStats || 0), homeGames),
        awayWithStats: Math.max(Number(merged.sampleSize?.awayWithStats || 0), awayGames),
      },
      homeStats: {
        ...(merged as any).homeStats,
        goalsFor: homeGF,
        goalsAgainst: homeGA,
        gamesCount: homeGames,
        leagueAvg: modelData.leagueAvg,
      },
      awayStats: {
        ...(merged as any).awayStats,
        goalsFor: awayGF,
        goalsAgainst: awayGA,
        gamesCount: awayGames,
        leagueAvg: modelData.leagueAvg,
      },
    } as MatchData;
    quantCache.set(key, { ts: Date.now(), match: enriched }); return enriched;
  } catch (e) { console.warn("[NEXUS-QUANT] team-form enrichment failed", e); return match; }
}

export function useMatchReading(match: MatchData, enabled: boolean) {
  const statsSignature = [match.modelData?.homeGoalsAvg, match.modelData?.awayGoalsAvg, match.modelData?.homeGoalsAgainstAvg, match.modelData?.awayGoalsAgainstAvg, match.sampleSize?.homeGames, match.sampleSize?.awayGames].join("|");
  const [state, setState] = useState<State>({ loading:false, reading:null, context:null, error:null, analyst:null, analystLoading:false, analystError:null, fallback:null });
  useEffect(() => {
    if (!enabled) return; let cancel = false;
    async function run() {
      const m:any=match; const fixtureId=m.fixture?.id || (typeof m.id === "number" ? m.id : null); const leagueId=m.league?.id||m.leagueId; const season=m.league?.season||m.season; const homeId=m.teams?.home?.id||m.homeId; const awayId=m.teams?.away?.id||m.awayId;
      setState(s=>({...s,loading:true,error:null,analyst:null})); const quantitativeMatch = await enrichQuantitativeData(match); if (cancel) return; let ctx:MatchContext|null=null;
      if(fixtureId){const key=String(fixtureId);const cached=memCache.get(key);if(cached&&Date.now()-cached.ts<TTL)ctx=cached.ctx;else{try{const {data,error}=await supabase.functions.invoke("match-context",{body:{fixtureId,leagueId,season,homeId,awayId,homeName:quantitativeMatch.homeTeam,awayName:quantitativeMatch.awayTeam,kickoffISO:m.fixture?.date}});if(!error&&data){ctx=data as MatchContext;memCache.set(key,{ts:Date.now(),ctx});}}catch(e){console.warn("match-context invoke fail",e);}}}
      let researchEvidence:ResearchEvidence[]=[];
      if(fixtureId&&ctx){const fields=getResearchGapFields(ctx);if(fields.length){const key=`${fixtureId}:${fields.join(",")}`;const cachedResearch=researchCache.get(key);if(cachedResearch&&Date.now()-cachedResearch.ts<RESEARCH_TTL)researchEvidence=cachedResearch.evidence;else{const research=await fetchResearchContext({id:fixtureId,homeTeam:quantitativeMatch.homeTeam,awayTeam:quantitativeMatch.awayTeam,league:quantitativeMatch.league,kickoff:m.fixture?.date,fields});if(research.evidence.length){researchEvidence=research.evidence;researchCache.set(key,{ts:Date.now(),evidence:researchEvidence});}}if(researchEvidence.length)ctx={...(ctx as any),researchEvidence} as MatchContext;}}
      const reading=buildMatchReadingV2(quantitativeMatch,ctx); if(cancel)return;
      let fallback:FallbackStats|null=null; const fkey=String(fixtureId||`${quantitativeMatch.homeTeam}-${quantitativeMatch.awayTeam}`); const cachedF=fallbackCache.get(fkey); if(cachedF&&Date.now()-cachedF.ts<FALLBACK_TTL)fallback=cachedF.data;else if(fixtureId||quantitativeMatch.homeTeam&&quantitativeMatch.awayTeam){try{const {data:fdata,error:ferror}=await supabase.functions.invoke("match-stats-resolver",{body:{matchId:String(fixtureId||fkey),homeTeam:quantitativeMatch.homeTeam,awayTeam:quantitativeMatch.awayTeam,league:quantitativeMatch.league,kickoffISO:m.fixture?.date}});if(!ferror&&fdata&&!fdata.error){fallback=fdata as FallbackStats;fallbackCache.set(fkey,{ts:Date.now(),data:fallback});}}catch(e){console.warn("match-stats-resolver invoke fail",e);}}
      if(cancel)return; const fallbackHasStats=Boolean(fallback?.confidence_score&&fallback.confidence_score>0&&fallback.stats&&Object.values(fallback.stats).some(v=>v!==null&&v!==undefined&&v!=="")); const dadosInsuficientes=!reading&&!fallbackHasStats; const kickoffMs=m.fixture?.date?new Date(m.fixture.date).getTime():NaN; const nearKickoff=Number.isFinite(kickoffMs)&&Math.abs(kickoffMs-Date.now())<=2*60*60*1000; const contextNeedsResearch=!ctx||ctx.reliability!=="completo"||Boolean((ctx as any)?.warnings?.includes?.("injuries_unavailable")); const pesquisaWeb=dadosInsuficientes||nearKickoff||contextNeedsResearch;
      setState({loading:false,reading,context:ctx,error:null,analyst:null,analystLoading:true,analystError:null,fallback}); const researchSignature=researchEvidence.map(e=>`${e.type}:${e.sourceType}:${e.observedAt}:${e.confidence}:${e.claim}`).join("|"); const akey=`${String(fixtureId||`${quantitativeMatch.homeTeam}-${quantitativeMatch.awayTeam}`)}:${pesquisaWeb?"research":"stats"}:${fallback?.source||"none"}:${statsSignature}:${quantitativeMatch.modelData?.historicalSample||0}:${researchSignature}`; const cachedA=analystCache.get(akey); if(cachedA&&Date.now()-cachedA.ts<ANALYST_TTL){if(!cancel)setState(s=>({...s,analyst:cachedA.data,analystLoading:false}));return;}
      try{const {data,error}=await supabase.functions.invoke("match-analyst",{body:{match:{id:fixtureId,homeTeam:quantitativeMatch.homeTeam,awayTeam:quantitativeMatch.awayTeam,league:quantitativeMatch.league,time:quantitativeMatch.time,status:quantitativeMatch.status,minute:quantitativeMatch.minute,matchProbabilities:(quantitativeMatch as any).matchProbabilities??null,venue:m.fixture?.venue?.name??null,fixtureType:m.fixture?.round??null},reading,context:ctx,fallbackStats:fallback,pesquisaWeb,researchEvidence}});if(cancel)return;const errCode:State["analystError"]=(data&&typeof data==="object"&&(data as any).error)||(error&&(error as any).message?.includes("429")?"rate_limited":null)||(error?"ai_error":null);if(!error&&data&&(data as any).cenario&&(data as any).veredito){const a:AnalystReading={cenario:data.cenario,pontoAtencao:data.pontoAtencao,veredito:data.veredito,risco:data.risco||"medio",aiAudit:data.aiAudit,contextoDetalhado:data.contextoDetalhado,mercados:data.mercados,oddsReferencia:data.oddsReferencia};analystCache.set(akey,{ts:Date.now(),data:a});setState(s=>({...s,analyst:a,analystLoading:false,analystError:null}));}else{const safeErr:State["analystError"]=errCode==="rate_limited"||errCode==="credits_exhausted"||errCode==="ai_error"||errCode==="parse_fail"?errCode:"ai_error";setState(s=>({...s,analystLoading:false,analystError:safeErr}));}}catch(e){console.warn("match-analyst invoke fail",e);if(!cancel)setState(s=>({...s,analystLoading:false,analystError:"ai_error"}));}
    }
    run(); return()=>{cancel=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[enabled,(match as any).fixture?.id||match.id,statsSignature]); return state;
}
