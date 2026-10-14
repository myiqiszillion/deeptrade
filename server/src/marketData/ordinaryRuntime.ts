import { ApprovalLease } from './approvalLease.js';
import { healthClock, HealthClock } from './feedHealth.js';
/** Ordinary backend approval is immutable at boot; credentials alone never activate it. */
export interface TradesRuntimeProfile {
  version: 1; approved: true; approvalId: string; expiresAt: string;
  dataset: 'GLBX.MDP3'; symbol: 'ES'; vendorSymbol: 'ES.c.0'; schema: 'trades';
  history: false; gex: false; quoteBoard: false; reconnect: false;
}
export function validateOrdinaryProfile(env: NodeJS.ProcessEnv, now = Date.now()): { profile?: Readonly<TradesRuntimeProfile>; reason: string } {
  const provider = (env.FUTURES_PROVIDER || 'none').toLowerCase();
  if (provider !== 'none' && provider !== 'databento') return { reason: 'Unknown futures provider: activation denied' };
  if (provider === 'none') return { reason: 'FUTURES_PROVIDER=none: ordinary vendor activation OFF' };
  if (env.DATABENTO_RUNTIME_START !== '1') return { reason: 'Explicit ordinary runtime start is OFF' };
  let p: any;
  try { p = JSON.parse(env.DATABENTO_RUNTIME_PROFILE || ''); }
  catch { return { reason: 'Missing or malformed approved runtime profile' }; }
  const expected = { version: 1, approved: true, dataset: 'GLBX.MDP3', symbol: 'ES', vendorSymbol: 'ES.c.0', schema: 'trades', history: false, gex: false, quoteBoard: false, reconnect: false };
  const keys = [...Object.keys(expected), 'approvalId', 'expiresAt'];
  if (!p || Object.keys(p).some(k => !keys.includes(k)) || Object.entries(expected).some(([k, v]) => p[k] !== v) ||
      typeof p.approvalId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(p.approvalId) || typeof p.expiresAt !== 'string' || !/Z$/.test(p.expiresAt)) {
    return { reason: 'Runtime profile scope invalid: only approved GLBX.MDP3 / ES / ES.c.0 / trades permitted' };
  }
  const expires = Date.parse(p.expiresAt);
  if (!Number.isFinite(expires) || expires <= now || expires - now > 86400000) return { reason: 'Runtime approval expired or exceeds 24-hour approval window' };
  if (!env.DATABENTO_API_KEY?.trim()) return { reason: 'Missing Databento key; approval does not supply credentials' };
  return { profile: Object.freeze({ ...p }), reason: 'Approved trades-only ordinary runtime' };
}
export class OrdinaryRuntimeGate {
  readonly profile?: Readonly<TradesRuntimeProfile>;
  readonly reason: string;
  readonly counters = { connectionAttempts: 0, subscriptionCommands: 0, subscriptionAcks: 0 };
  private readonly key: string;
  private lease?: ApprovalLease;
  private expiresMono = 0;
  constructor(env: NodeJS.ProcessEnv, now = Date.now(), private clock: HealthClock = healthClock) {
    const result = validateOrdinaryProfile(env, now);
    if (result.profile) {
      try {
        this.lease = new ApprovalLease(env.DATABENTO_APPROVAL_LEDGER || '', result.profile.approvalId, Date.parse(result.profile.expiresAt), now);
        this.profile = result.profile;
        this.expiresMono = this.clock.mono() + Date.parse(result.profile.expiresAt) - now;
      } catch (error) { result.reason = 'Durable approval denied: ' + (error as Error).message; }
    }
    this.reason = result.reason;
    this.key = this.profile ? env.DATABENTO_API_KEY!.trim() : '';
  }
  allows(symbol: string): boolean { return !!this.profile && symbol === this.profile.symbol && Date.parse(this.profile.expiresAt) > this.clock.wall() && this.clock.mono() < this.expiresMono && !!this.lease?.valid(this.clock.wall()); }
  credentials(): string { return this.key; }
  claimConnection(symbol: string): void {
    if (!this.allows(symbol)) throw new Error('Ordinary runtime scope/expiry denied');
    if (this.counters.connectionAttempts !== 0) throw new Error('Ordinary runtime connection budget exhausted (1 durable attempt per approval; no retry)');
    this.lease!.consume('attempts', this.clock.wall());
    this.counters.connectionAttempts++;
  }
  subscription(): void {
    if (this.counters.connectionAttempts !== 1 || this.counters.subscriptionCommands !== 0) throw new Error('Ordinary subscription budget exhausted');
    if (!this.allows('ES')) throw new Error('Ordinary runtime scope/expiry denied');
    this.lease!.consume('commands', this.clock.wall());
    this.counters.subscriptionCommands++;
  }
  ack(): void { if (this.counters.subscriptionAcks) return; this.lease!.consume('acks', this.clock.wall()); this.counters.subscriptionAcks++; }
}
let runtime: OrdinaryRuntimeGate | undefined;
export function initializeOrdinaryRuntime(env: NodeJS.ProcessEnv = process.env): OrdinaryRuntimeGate {
  if (runtime) throw new Error('Ordinary runtime is immutable until backend restart');
  return runtime = new OrdinaryRuntimeGate({ ...env });
}
export function ordinaryRuntime(): OrdinaryRuntimeGate | undefined { return runtime; }
export function ordinaryExternalFetchDisabled(): boolean { return !!runtime; }
