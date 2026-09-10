// Política compartilhada de qualidade de confiança.
// >=85 normal; 70-84 conservador; 50-69 informativo; <50 descartado.
// A política não é, sozinha, autorização de SIGNAL: Nexus Core continua sendo a autoridade final.
export type ConfidenceMode = 'normal' | 'conservative' | 'info_only' | 'discard';
export interface ConfidencePolicy { mode: ConfidenceMode; allowSignals: boolean; conservative: boolean; label: string; }
export function classifyConfidence(score:number|null|undefined):ConfidencePolicy {
  const s=typeof score==='number'&&Number.isFinite(score)?Math.min(95,Math.max(0,score)):0;
  if(s>=85)return{mode:'normal',allowSignals:true,conservative:false,label:'normal'};
  if(s>=70)return{mode:'conservative',allowSignals:true,conservative:true,label:'conservador'};
  if(s>=50)return{mode:'info_only',allowSignals:false,conservative:false,label:'informativo'};
  return{mode:'discard',allowSignals:false,conservative:false,label:'descartado'};
}
export async function resolveMatchConfidence(supabaseUrl:string,serviceRoleKey:string,payload:{matchId:string|number;homeTeam:string;awayTeam:string;league?:string|null;kickoffISO?:string|null},timeoutMs=5000):Promise<{score:number;source:string;ok:boolean}> {
  try{
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),timeoutMs);
    try{
      const r=await fetch(`${supabaseUrl}/functions/v1/match-stats-resolver`,{method:'POST',headers:{Authorization:`Bearer ${serviceRoleKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctrl.signal});
      if(!r.ok)return{score:0,source:'resolver_error',ok:false};
      const j=await r.json(); const score=Number(j?.confidence_score);
      if(!Number.isFinite(score))return{score:0,source:'resolver_invalid',ok:false};
      return{score:Math.min(95,Math.max(0,score)),source:String(j?.source??'unknown'),ok:true};
    }finally{clearTimeout(t);}
  }catch{return{score:0,source:'resolver_unreachable',ok:false};}
}
export function logConfidenceDecision(tag:string,match:string,score:number,mode:ConfidenceMode,source:string){
  if(mode==='normal')return;
  const icon=mode==='conservative'?'🟡':mode==='info_only'?'🔵':'🔴';
  console.log(`[${tag}][CONFIDENCE] ${icon} ${match} • score=${score} • mode=${mode} • source=${source}`);
}
