/** Health is evidence, not a socket flag. Freshness uses monotonic local observation time. */
export interface HealthClock { wall(): number; mono(): number }
export const healthClock: HealthClock = { wall: () => Date.now(), mono: () => performance.now() };
export type HealthState = 'DISABLED' | 'CONNECTING' | 'AUTHENTICATED' | 'SUBSCRIBING' | 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'BLOCKED' | 'INDETERMINATE' | 'MARKET_CLOSED';
export class FeedHealth {
  private phase: HealthState = 'DISABLED';
  private reason = 'Vendor activation OFF';
  private terminal = false;
  private activityMono: number | null = null;
  private tradeMono: number | null = null;
  private startedMono: number | null = null;
  private expiryWall: number | undefined;
  private expiryMono: number | undefined;
  private vendorEventNs: string | null = null;
  private vendorReceiveNs: string | null = null;
  private times = { decoderReceiveAt: null as number | null, transportAt: null as number | null, authenticatedAt: null as number | null, subscriptionAt: null as number | null, ackAt: null as number | null, vendorControlAt: null as number | null, acceptedAt: null as number | null, vendorEventAt: null as number | null, persistedAt: null as number | null, publishedAt: null as number | null };
  private counts = { accepted: 0, persisted: 0, published: 0, controls: 0, acks: 0 };
  constructor(private clock: HealthClock = healthClock) {}
  begin(expiresAt?: string) {
    if (this.terminal) return;
    this.phase = 'CONNECTING'; this.reason = 'Waiting for vendor authentication'; this.startedMono = this.clock.mono();
    if (expiresAt) { this.expiryWall = Date.parse(expiresAt); this.expiryMono = this.clock.mono() + this.expiryWall - this.clock.wall(); }
  }
  signal(state: string, reason?: string) {
    if (this.terminal) return;
    const now = this.clock.wall();
    if (state === 'DISABLED') { this.phase = 'DISABLED'; this.reason = reason || 'Vendor activation OFF'; return; }
    if (state === 'CONNECTING') { this.begin(); return; }
    if (state === 'TRANSPORT') this.times.transportAt = now;
    if (state === 'AUTHENTICATED') { this.times.authenticatedAt = now; this.phase = 'AUTHENTICATED'; }
    if (state === 'SUBSCRIBING') { this.times.subscriptionAt = now; this.phase = 'SUBSCRIBING'; }
    if (state === 'ACKNOWLEDGED' || state === 'LIVE') { // legacy fixture providers report readiness explicitly
      if (!this.times.ackAt) { this.times.ackAt = now; this.counts.acks++; }
      this.activityMono = this.clock.mono(); this.phase = 'INDETERMINATE';
      this.reason = 'Subscription accepted; no accepted market observation yet'; return;
    }
    if (state === 'CONTROL') { this.times.vendorControlAt = now; this.activityMono = this.clock.mono(); this.counts.controls++; return; }
    if (state === 'ERROR' || state === 'UNAVAILABLE' || state === 'BLOCKED') { this.stop(reason || 'Vendor unavailable', state === 'BLOCKED' || !!reason?.toLowerCase().includes('approval expired')); return; }
    this.reason = reason || (state === 'SUBSCRIBING' ? 'Waiting for subscription ACK' : 'Waiting for subscription command');
  }
  accepted(eventTs: number, persisted: boolean, decoderReceiveAt?: number, eventNs?: string, vendorReceiveNs?: string) {
    if (this.terminal) return;
    this.times.decoderReceiveAt = decoderReceiveAt ?? null; this.vendorEventNs = eventNs ?? null; this.vendorReceiveNs = vendorReceiveNs ?? null;
    this.counts.accepted++; this.times.acceptedAt = this.clock.wall(); this.times.vendorEventAt = eventTs;
    this.tradeMono = this.activityMono = this.clock.mono();
    if (persisted) { this.counts.persisted++; this.times.persistedAt = this.clock.wall(); }
  }
  published() { if (!this.terminal) { this.counts.published++; this.times.publishedAt = this.clock.wall(); } }
  stop(reason = 'Feed stopped; retained charts are past observations', blocked = false) {
    if (this.terminal) return;
    this.terminal = true; this.phase = blocked ? 'BLOCKED' : 'UNAVAILABLE'; this.reason = reason;
  }
  expired() { return this.expiryWall !== undefined && (this.clock.wall() >= this.expiryWall || this.clock.mono() >= this.expiryMono!); }
  snapshot(marketOpen = true) {
    let state = this.phase, reason = this.reason;
    if (!this.terminal && this.expired()) { state = 'BLOCKED'; reason = 'Approval expired; socket must close, renewed profile required'; }
    else if (!this.terminal && this.phase !== 'DISABLED') {
      const idle = this.activityMono ?? this.startedMono;
      if (idle !== null && this.clock.mono() - idle > 60000) { state = 'STALE'; reason = 'No validated vendor activity for 60s; quiet versus stalled UNKNOWN (local policy, not vendor SLA)'; }
      else if (this.times.ackAt !== null) {
        if (!marketOpen) { state = 'MARKET_CLOSED'; reason = 'Static calendar closed; holiday and vendor session status not verified'; }
        else if (this.tradeMono !== null && this.clock.mono() - this.tradeMono <= 30000) { state = 'LIVE'; reason = 'ACK plus accepted market observation within 30s; feed latency/continuity not verified'; }
        else { state = 'INDETERMINATE'; reason = 'Subscription accepted; market quiet versus stalled UNKNOWN; controls do not prove market freshness'; }
      }
    }
    return { state, reason, transportConnected: this.times.transportAt !== null && !this.terminal, authenticated: this.times.authenticatedAt !== null, acknowledged: this.times.ackAt !== null, times: { ...this.times }, vendorEventNs: this.vendorEventNs, vendorReceiveNs: this.vendorReceiveNs, counters: { ...this.counts }, policy: 'accepted observation <=30s; validated vendor silence >60s; monotonic ages; no latency claim' };
  }
}
