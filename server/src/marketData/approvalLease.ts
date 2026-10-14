import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Separate durable, fail-closed one-boot lease. No credential or market records are stored. */
export class ApprovalLease {
  private readonly owner = randomUUID();
  constructor(private readonly path: string, private readonly id: string, private readonly expires: number, now: number) {
    if (!isAbsolute(path) || basename(path).toLowerCase() === 'market_data.sqlite' ||
        (process.env.STORAGE_PATH && resolve(path) === resolve(process.env.STORAGE_PATH))) throw new Error('Separate absolute approval ledger path required');
    if (!(globalThis as any)[Symbol.for('deepchart.offline.guard')] && !existsSync(path)) throw new Error('Approval ledger must be durably provisioned by Operator before activation');
    this.transaction(db => {
      db.exec('CREATE TABLE IF NOT EXISTS approval_leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, commands INTEGER NOT NULL DEFAULT 0, acks INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS approval_clock (id INTEGER PRIMARY KEY CHECK(id=1), highwater REAL NOT NULL);');
      const high = db.prepare('SELECT highwater FROM approval_clock WHERE id=1').get() as any;
      if (high && now < high.highwater) throw new Error('Approval ledger clock rollback: Operator reconciliation required');
      db.prepare('INSERT INTO approval_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET highwater=max(highwater,excluded.highwater)').run(now);
      // Reservation is consumed even if the process crashes before its first TCP attempt.
      if (db.prepare('SELECT id FROM approval_leases WHERE id=?').get(id)) throw new Error('Approval already reserved/consumed/revoked; renewed approval required');
      db.prepare("INSERT INTO approval_leases(id,owner,expires,state) VALUES(?,?,?,'RESERVED')").run(id,this.owner,expires);
    });
  }
  private transaction<T>(action: (db: DatabaseSync) => T): T {
    const db=new DatabaseSync(this.path);
    try { db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; BEGIN IMMEDIATE;'); const value=action(db); db.exec('COMMIT'); return value; }
    catch(error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    finally { db.close(); }
  }
  valid(now:number): boolean {
    try { return this.transaction(db => {
      const row=db.prepare('SELECT * FROM approval_leases WHERE id=?').get(this.id) as any;
      const high=db.prepare('SELECT highwater FROM approval_clock WHERE id=1').get() as any;
      if (!row || row.owner!==this.owner || row.state==='REVOKED' || row.expires!==this.expires || now>=row.expires || now<high.highwater) return false;
      db.prepare('UPDATE approval_clock SET highwater=max(highwater,?) WHERE id=1').run(now); return true;
    }); } catch { return false; }
  }
  consume(kind:'attempts'|'commands'|'acks',now:number): void {
    this.transaction(db => {
      const row=db.prepare('SELECT * FROM approval_leases WHERE id=?').get(this.id) as any;
      const high=db.prepare('SELECT highwater FROM approval_clock WHERE id=1').get() as any;
      if (!row || row.owner!==this.owner || row.state==='REVOKED' || now>=row.expires || now<high.highwater || row[kind]!==0 ||
          (kind!=='attempts' && row.attempts!==1) || (kind==='acks' && row.commands!==1)) throw new Error('Durable approval scope/expiry/budget denied');
      db.prepare(`UPDATE approval_leases SET ${kind}=1,state='CONSUMED' WHERE id=?`).run(this.id);
      db.prepare('UPDATE approval_clock SET highwater=max(highwater,?) WHERE id=1').run(now);
    });
  }
}
