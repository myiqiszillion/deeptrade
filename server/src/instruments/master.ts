export interface InstrumentMasterRecord {
  instrumentId: number; dataset: string; publisherId: number;
  rawSymbol: string; securityType: string; asset: string;
  underlying?: string; exchange: string; venue?: string;
  activation?: string; expiration?: string;
  strike?: number; optionType?: 'call' | 'put';
  currency: string; tickSize: number; multiplier: number;
  figi?: string; isin?: string; cusip?: string;
  parentInstrumentId?: number; isContinuous: boolean; continuousRoot?: string;
}

import { marketDataStore } from '../storage/marketDataStore.js';

export class InstrumentMaster {
  upsert(records: InstrumentMasterRecord[]): number {
    let n = 0;
    for (const r of records) {
      try {
        (marketDataStore as any).db?.prepare?.(`
          INSERT OR REPLACE INTO instrument_master
          (instrument_id, dataset, publisher_id, raw_symbol, security_type, asset, underlying, exchange, venue, activation, expiration, strike, option_type, currency, tick_size, multiplier, figi, isin, cusip, parent_instrument_id, is_continuous, continuous_root, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)?.run(
          r.instrumentId, r.dataset, r.publisherId, r.rawSymbol, r.securityType, r.asset, r.underlying ?? null, r.exchange, r.venue ?? null,
          r.activation ?? null, r.expiration ?? null, r.strike ?? null, r.optionType ?? null, r.currency, r.tickSize, r.multiplier,
          r.figi ?? null, r.isin ?? null, r.cusip ?? null, r.parentInstrumentId ?? null, r.isContinuous ? 1 : 0, r.continuousRoot ?? null, Date.now()
        );
        n++;
      } catch {}
    }
    return n;
  }
  getByInstrumentId(id: number): InstrumentMasterRecord | null {
    try {
      const row = (marketDataStore as any).db?.prepare('SELECT * FROM instrument_master WHERE instrument_id = ?')?.get(id) as any;
      if (!row) return null;
      return mapRow(row);
    } catch { return null; }
  }
  getByRawSymbol(dataset: string, rawSymbol: string): InstrumentMasterRecord | null {
    try {
      const row = (marketDataStore as any).db?.prepare('SELECT * FROM instrument_master WHERE dataset = ? AND raw_symbol = ?')?.get(dataset, rawSymbol) as any;
      if (!row) return null;
      return mapRow(row);
    } catch { return null; }
  }
  search(q: { asset?: string; dataset?: string; underlying?: string }): InstrumentMasterRecord[] {
    try {
      let sql = 'SELECT * FROM instrument_master WHERE 1=1';
      const params: any[] = [];
      if (q.asset) { sql += ' AND asset = ?'; params.push(q.asset.toUpperCase()); }
      if (q.dataset) { sql += ' AND dataset = ?'; params.push(q.dataset); }
      if (q.underlying) { sql += ' AND underlying = ?'; params.push(q.underlying.toUpperCase()); }
      sql += ' LIMIT 500';
      const rows = (marketDataStore as any).db?.prepare(sql)?.all(...params) as any[] ?? [];
      return rows.map(mapRow);
    } catch { return []; }
  }
}
function mapRow(r: any): InstrumentMasterRecord {
  return {
    instrumentId: r.instrument_id, dataset: r.dataset, publisherId: r.publisher_id,
    rawSymbol: r.raw_symbol, securityType: r.security_type, asset: r.asset,
    underlying: r.underlying, exchange: r.exchange, venue: r.venue,
    activation: r.activation, expiration: r.expiration, strike: r.strike,
    optionType: r.option_type, currency: r.currency, tickSize: r.tick_size, multiplier: r.multiplier,
    figi: r.figi, isin: r.isin, cusip: r.cusip,
    parentInstrumentId: r.parent_instrument_id, isContinuous: Boolean(r.is_continuous), continuousRoot: r.continuous_root,
  };
}
export const instrumentMaster = new InstrumentMaster();
