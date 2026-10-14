import type { Tick, WSServerMessage } from '../types.js';
export type DataSource = 'VENDOR_LIVE' | 'VENDOR_HISTORICAL' | 'LOCAL_FIXTURE' | 'PERSISTED_VENDOR' | 'HISTORICAL_ESTIMATE' | 'LEGACY' | 'UNKNOWN' | 'MIXED';
export interface DataEvidence {
  source: DataSource;
  quality: 'EXACT' | 'ESTIMATED' | 'UNKNOWN';
  coverage: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  reason: string;
  delivery?: 'OBSERVED' | 'SQLITE' | 'REPLAY';
  originalSource?: DataSource;
  contracts?: string[];
  fromTs?: number;
  toTs?: number;
  cvdBaseline?: 'OBSERVED_START';
}
const sources: DataSource[] = ['VENDOR_LIVE','VENDOR_HISTORICAL','LOCAL_FIXTURE','PERSISTED_VENDOR','HISTORICAL_ESTIMATE','LEGACY','UNKNOWN','MIXED'];
export function evidence(source: DataSource = 'UNKNOWN'): DataEvidence {
  // DBN shape and provider name do not prove origin. Offline guard always forbids vendor attribution.
  if ((globalThis as any)[Symbol.for('deepchart.offline.guard')] && ['VENDOR_LIVE','VENDOR_HISTORICAL','PERSISTED_VENDOR'].includes(source)) source='LOCAL_FIXTURE';
  return {source,quality:source==='HISTORICAL_ESTIMATE'?'ESTIMATED':['UNKNOWN','LEGACY','MIXED'].includes(source)?'UNKNOWN':'EXACT',coverage:'PARTIAL',reason:'Observed records only; session completeness and venue sequence continuity not verified',delivery:'OBSERVED',cvdBaseline:'OBSERVED_START'};
}
export function evidenceOf(t: {dataEvidence?: DataEvidence; identityKind?: string; sourceProvider?: string}): DataEvidence {
  const m=t.dataEvidence;
  if (!m || !sources.includes(m.source)) return evidence(t.identityKind==='LEGACY'?'LEGACY':'UNKNOWN');
  const safe=evidence(m.source);
  if (m.quality==='ESTIMATED'||m.quality==='UNKNOWN') safe.quality=m.quality;
  return {...safe,delivery:m.delivery==='SQLITE'?'SQLITE':m.delivery==='REPLAY'?'REPLAY':'OBSERVED',originalSource:m.originalSource===m.source||(m.source==='PERSISTED_VENDOR'&&['VENDOR_LIVE','VENDOR_HISTORICAL'].includes(m.originalSource!))?m.originalSource:undefined};
}
export function contractKey(t: {vendorIdentity?: readonly unknown[]}): string | undefined {
  const v=t.vendorIdentity;return v ? `${v[0]}/${v[1]}/${v[2]}` : undefined;
}
export function contractWindow(ticks: Tick[]): {ticks: Tick[]; excluded: number} {
  const latest=[...ticks].sort((a,b)=>b.timestamp-a.timestamp).find(t=>contractKey(t));const key=latest&&contractKey(latest);
  const filtered=key?ticks.filter(t=>!contractKey(t)||contractKey(t)===key):ticks;
  return {ticks:filtered,excluded:ticks.length-filtered.length};
}
const prefix='trade-source-v1:';
export function encodeTradeSource(provider: string, t: {dataEvidence?: DataEvidence;identityKind?: string}): string {
  if (!t.dataEvidence) return provider; // Preserve old provider strings and legacy compatibility.
  return prefix+JSON.stringify({provider,evidence:evidenceOf(t)});
}
export function restoreTradeSource(value: string | null): {sourceProvider?: string;dataEvidence: DataEvidence} {
  if (!value?.startsWith(prefix)) return {sourceProvider:value??undefined,dataEvidence:{...evidence('LEGACY'),delivery:'SQLITE',reason:'Legacy row: original source not captured; provider/ID alone cannot prove vendor origin'}};
  try {
    const p=JSON.parse(value.slice(prefix.length));if(typeof p.provider!=='string'||!sources.includes(p.evidence?.source)) throw Error();
    const m=evidenceOf({dataEvidence:p.evidence});const origin=['VENDOR_LIVE','VENDOR_HISTORICAL'].includes(m.source) ? m.source : m.source==='PERSISTED_VENDOR'&&['VENDOR_LIVE','VENDOR_HISTORICAL'].includes(m.originalSource!) ? m.originalSource! : m.source;
    return {sourceProvider:p.provider,dataEvidence:{...m,source:['VENDOR_LIVE','VENDOR_HISTORICAL'].includes(origin)?evidence('PERSISTED_VENDOR').source:m.source,originalSource:origin,delivery:'SQLITE',reason:'Committed SQLite observation window; full-session completeness not verified'}};
  } catch {return {sourceProvider:undefined,dataEvidence:{...evidence('UNKNOWN'),delivery:'SQLITE',reason:'Unrecognized persisted source envelope'}};}
}
export class ObservationEvidence {
  private origins=new Set<DataSource>();private contracts=new Set<string>();private quality:DataEvidence['quality']='EXACT';
  private fromTs:number|undefined;private toTs:number|undefined;private count=0;private boundaries=new Set<string>();
  public observe(t: Tick): void {const m=evidenceOf(t);this.origins.add(m.source);if(m.quality==='ESTIMATED')this.quality='ESTIMATED';else if(m.quality==='UNKNOWN'&&this.quality!=='ESTIMATED')this.quality='UNKNOWN';const k=contractKey(t);if(k&&this.contracts.size<64)this.contracts.add(k);if(!k)this.partial('Some records have no verified contract metadata');if(m.delivery==='SQLITE')this.partial('Bounded SQLite restored observations; prefix/session completeness not verified');this.fromTs=Math.min(this.fromTs??t.timestamp,t.timestamp);this.toTs=Math.max(this.toTs??t.timestamp,t.timestamp);this.count++;}
  public estimated(): void {this.origins.add('HISTORICAL_ESTIMATE');this.quality='ESTIMATED';this.partial('Historical OHLCV distribution is estimated; mixed ticks cannot restore exactness');}
  public partial(reason:string): void {if(this.boundaries.size<12)this.boundaries.add(reason); }
  public snapshot(): DataEvidence {const source=this.origins.size===1?[...this.origins][0]:this.origins.size?'MIXED':'UNKNOWN';return {source,quality:this.count||this.origins.size?this.quality:'UNKNOWN',coverage:this.count||this.origins.size?'PARTIAL':'UNKNOWN',reason:[...this.boundaries].join('; ')||'Bounded observation; session start, gaps and sequence continuity not verified',contracts:[...this.contracts],fromTs:this.fromTs,toTs:this.toTs,cvdBaseline:'OBSERVED_START'};}
}
/** DTO annotations are observation-cohort scope; never silently manufacture per-bar vendor metadata. */
export function annotateMessage(msg: WSServerMessage, scope: DataEvidence): WSServerMessage {
  const m:any={...msg};
  if(m.tick)m.tick={...m.tick,dataEvidence:evidenceOf(m.tick)};
  if(m.bar)m.bar={...m.bar,dataEvidence:scope};
  if(m.type==='INIT_STATE'){m.dataEvidence=scope;m.bars=m.bars.map((b:any)=>({...b,dataEvidence:scope}));m.historyBars=m.historyBars?.map((b:any)=>({...b,dataEvidence:b.dataEvidence||evidence('UNKNOWN')}));}
  if(m.type==='HISTORY_RESPONSE')m.bars=m.bars.map((b:any)=>({...b,dataEvidence:b.dataEvidence||evidence('UNKNOWN')}));
  if(m.tpo)m.tpo={...m.tpo,dataEvidence:scope};
  if(m.volumeProfile)m.volumeProfile={...m.volumeProfile,dataEvidence:scope,coverage:scope.coverage,coverageReason:scope.reason};
  return m;
}
