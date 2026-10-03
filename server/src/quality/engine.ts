export interface QualityReport { passed: boolean; issues: string[]; }
export class DataQualityEngine {
  checkTrade(payload: any): QualityReport {
    const issues: string[] = [];
    if (!Number.isFinite(payload.price) || payload.price <= 0) issues.push('bad_price');
    if (!Number.isFinite(payload.size) || payload.size <= 0) issues.push('bad_size');
    if (payload.tsEvent != null && payload.tsEvent <= 0) issues.push('bad_timestamp');
    return { passed: issues.length === 0, issues };
  }
  checkQuote(payload: any): QualityReport {
    const issues: string[] = [];
    if (payload.bidPx != null && payload.askPx != null && payload.bidPx >= payload.askPx) issues.push('crossed_quote');
    if (payload.bidPx === payload.askPx) issues.push('locked_market');
    return { passed: issues.length === 0, issues };
  }
  checkOutOfOrder(prevTs: number, curTs: number): QualityReport {
    return curTs < prevTs ? { passed: false, issues: ['out_of_order'] } : { passed: true, issues: [] };
  }
}
export const dataQualityEngine = new DataQualityEngine();
