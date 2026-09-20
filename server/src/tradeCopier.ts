import { SlaveAccount } from './types.js';

/** Risk multipliers must stay in a sane band: negative or huge values would copy nonsense sizes. */
function clampMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(10, Math.max(0, Math.round(value * 100) / 100));
}

export class TradeCopierEngine {
  private slaves: Map<string, SlaveAccount> = new Map();
  private onCopiedCallback: ((slaveId: string, symbol: string, size: number, price: number, latencyMs: number) => void) | null = null;

  constructor() {
    // Default mock accounts for demonstration / live testing
    this.addSlave({
      id: 'slave_binance_1',
      name: 'Sub-Account #1 (Bybit / 1.0x)',
      multiplier: 1.0,
      enabled: true,
      status: 'connected',
    });
    this.addSlave({
      id: 'slave_binance_2',
      name: 'Prop-Firm Account #2 (0.5x Risk)',
      multiplier: 0.5,
      enabled: true,
      status: 'connected',
    });
    this.addSlave({
      id: 'slave_binance_3',
      name: 'High-Freq Scalper #3 (2.0x)',
      multiplier: 2.0,
      enabled: false,
      status: 'idle',
    });
  }

  public addSlave(slave: SlaveAccount) {
    this.slaves.set(slave.id, { ...slave, multiplier: clampMultiplier(slave.multiplier) });
  }

  public updateSlave(slave: SlaveAccount) {
    this.slaves.set(slave.id, { ...slave, multiplier: clampMultiplier(slave.multiplier) });
  }

  public getSlaves(): SlaveAccount[] {
    return Array.from(this.slaves.values());
  }

  public setCallback(callback: (slaveId: string, symbol: string, size: number, price: number, latencyMs: number) => void) {
    this.onCopiedCallback = callback;
  }

  public async copyOrder(symbol: string, action: 'BUY' | 'SELL', masterSize: number, price: number): Promise<void> {
    const startTime = Date.now();

    for (const slave of this.slaves.values()) {
      if (!slave.enabled || slave.status !== 'connected') continue;

      const slaveSize = Math.round(masterSize * slave.multiplier * 1000) / 1000;
      
      // Simulate ultra-low latency execution (10ms - 35ms)
      const simulatedLatency = Math.floor(Math.random() * 25) + 10;
      slave.latencyMs = simulatedLatency;
      slave.lastCopiedOrder = `${action} ${slaveSize} @ ${price}`;

      if (this.onCopiedCallback) {
        this.onCopiedCallback(slave.id, symbol, slaveSize, price, simulatedLatency);
      }
    }
  }
}
