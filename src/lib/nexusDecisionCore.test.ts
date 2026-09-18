import { describe, expect, it } from 'vitest';
import { decideNexus } from './nexusDecisionCore';

const match = { id:'1', homeTeam:'A', awayTeam:'B', league:'L', isLive:false, status:'NS', minute:0 } as const;
const market = (odd:number|null) => ({ market:'Over 2.5 Gols', probability:86, risk:'baixo', category:'goals', probabilitySource:'MODEL_ESTIMATE' as const, calibrationStatus:'CALIBRATED' as const, odd:odd ?? undefined, oddSource:odd != null ? 'OBSERVED' as const : 'UNKNOWN' as const });

const research = [{
  type:'INJURY' as const,
  sourceType:'WEB' as const,
  sourceName:'Verified source',
  sourceUrl:'https://example.com',
  observedAt:'2026-09-15T20:00:00Z',
  observed:true,
  estimated:false,
  confidence:90,
  claim:'Titular ausente por lesão',
}];

describe('Nexus Core pre-match hardening', () => {
  it('does not emit signal without observed market odd', () => {
    const r = decideNexus({match,mode:'PRE_MATCH',confidence:90,markets:[market(null)],evidence:[{source:'market',name:'m',value:86}],dataQuality:{status:'VALID',score:90,reasons:[]},calibrationStatus:'CALIBRATED',probabilitySource:'MODEL_ESTIMATE'});
    expect(r.decision).toBe('CONSERVATIVE');
    expect(r.signalEligible).toBe(false);
    expect(r.reasonCodes).toContain('MARKET_ODD_MISSING');
  });
  it('emits signal only when calibrated model and real odd are present', () => {
    const r = decideNexus({match,mode:'PRE_MATCH',confidence:90,markets:[market(1.25)],evidence:[{source:'market',name:'m',value:86}],dataQuality:{status:'VALID',score:90,reasons:[]},calibrationStatus:'CALIBRATED',probabilitySource:'MODEL_ESTIMATE'});
    expect(r.decision).toBe('SIGNAL');
    expect(r.signalEligible).toBe(true);
  });
  it('rejects uncalibrated market even with high confidence', () => {
    const r = decideNexus({match,mode:'PRE_MATCH',confidence:95,markets:[{...market(1.25),calibrationStatus:'UNCALIBRATED'}],evidence:[{source:'market',name:'m',value:95}],dataQuality:{status:'VALID',score:95,reasons:[]},calibrationStatus:'UNCALIBRATED',probabilitySource:'MODEL_ESTIMATE'});
    expect(r.decision).not.toBe('SIGNAL');
  });
  it('accepts sourced web research as context without changing the model probability', () => {
    const r = decideNexus({match,mode:'PRE_MATCH',confidence:90,markets:[market(1.25)],evidence:[{source:'market',name:'m',value:86}],researchEvidence:research,dataQuality:{status:'VALID',score:90,reasons:[]},calibrationStatus:'CALIBRATED',probabilitySource:'MODEL_ESTIMATE'});
    expect(r.decision).toBe('SIGNAL');
    expect(r.selectedMarket?.probability).toBe(86);
    expect(r.reasonCodes).toContain('CORE_APPROVED_SIGNAL');
  });
  it('never lets research replace a missing market odd', () => {
    const r = decideNexus({match,mode:'PRE_MATCH',confidence:90,markets:[market(null)],evidence:[{source:'market',name:'m',value:86}],researchEvidence:research,dataQuality:{status:'VALID',score:90,reasons:[]},calibrationStatus:'CALIBRATED',probabilitySource:'MODEL_ESTIMATE'});
    expect(r.signalEligible).toBe(false);
    expect(r.reasonCodes).toContain('MARKET_ODD_MISSING');
  });
  it('não usa probabilidade não validada para superar o limiar do mercado validado', () => {
    const validated = market(1.25);
    const unvalidated = {...market(1.1), market:'Over 4.5 Escanteios', probability:99, calibrationStatus:'UNCALIBRATED' as const};
    const r = decideNexus({match,mode:'PRE_MATCH',confidence:90,markets:[validated,unvalidated],evidence:[{source:'market',name:'m',value:90}],dataQuality:{status:'VALID',score:90,reasons:[]},calibrationStatus:'CALIBRATED',probabilitySource:'MODEL_ESTIMATE'});
    expect(r.decision).toBe('SIGNAL');
    expect(r.selectedMarket?.market).toBe('Over 2.5 Gols');
  });

  it('bloqueia quando o único mercado validado está abaixo do limiar mesmo que outro mercado não validado seja alto', () => {
    const validated = {...market(1.4), probability:70};
    const unvalidated = {...market(1.1), market:'Over 4.5 Escanteios', probability:99, calibrationStatus:'UNCALIBRATED' as const};
    const r = decideNexus({match,mode:'PRE_MATCH',confidence:90,markets:[validated,unvalidated],evidence:[{source:'market',name:'m',value:90}],dataQuality:{status:'VALID',score:90,reasons:[]},calibrationStatus:'CALIBRATED',probabilitySource:'MODEL_ESTIMATE'});
    expect(r.decision).toBe('INFO_ONLY');
    expect(r.signalEligible).toBe(false);
    expect(r.reasonCodes).toContain('MARKET_BELOW_THRESHOLD');
  });

});
