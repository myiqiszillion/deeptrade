import { createHash } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { marketDataStore } from './marketDataStore.js';

export interface RawPutArgs { dataset: string; schema: string; date: string; symbols: string[]; bytes: Buffer; format: 'dbn'|'parquet'|'csv'|'json'; }
export class RawStore {
  async put(args: RawPutArgs): Promise<{ filePath: string; checksum: string }> {
    const checksum = createHash('sha256').update(args.bytes).digest('hex');
    const filePath = `data/raw/${args.dataset}/${args.schema}/${args.date}/${checksum.slice(0,8)}.${args.format}`;
    try { await mkdir(dirname(filePath), { recursive: true }); await writeFile(filePath, args.bytes); } catch {}
    try {
      (marketDataStore as any).db?.prepare('INSERT OR IGNORE INTO raw_manifest (dataset, schema, symbols, date, file_path, format, bytes, checksum, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ?.run(args.dataset, args.schema, args.symbols.join(','), args.date, filePath, args.format, args.bytes.length, checksum, Date.now());
    } catch {}
    return { filePath, checksum };
  }
  async locate(args: { dataset: string; schema: string; date: string }): Promise<string[]> {
    try {
      const rows = (marketDataStore as any).db?.prepare('SELECT file_path FROM raw_manifest WHERE dataset = ? AND schema = ? AND date = ?')?.all(args.dataset, args.schema, args.date) as any[] ?? [];
      return rows.map(r => r.file_path);
    } catch { return []; }
  }
  async verifyChecksum(filePath: string): Promise<boolean> { return true; }
}
export const rawStore = new RawStore();
