export type TrailingMode = 'INTRADAY_PEAK' | 'END_OF_DAY';

export interface PropAccountConfig {
  accountName: string;
  firmName: 'Topstep' | 'Apex' | 'MyFundedFutures' | 'Bulenox' | 'FTMO';
  initialBalance: number; // e.g. 50000
  profitTarget: number;   // e.g. 3000
  maxTrailingDrawdown: number; // e.g. 2500
  dailyLossLimit: number; // e.g. 1000
  maxContractsMini: number; // e.g. 5
  maxContractsMicro: number; // e.g. 50
  trailingMode: TrailingMode;
  consistencyTargetPercent: number; // e.g. 30%
}

export interface PropAccountState {
  balance: number;
  equity: number;
  peakHighWaterMark: number;
  trailingThreshold: number;
  trailingBufferRemaining: number;
  trailingBufferPercent: number;
  todayPnL: number;
  dailyLossRemaining: number;
  dailyLossPercent: number;
  profitTargetProgressPercent: number;
  highestDayProfit: number;
  consistencyPercent: number;
  isDailyLossBreached: boolean;
  isDrawdownBreached: boolean;
  isLockedOut: boolean;
  openContractsCount: number;
}

export class PropRiskEngine {
  private config: PropAccountConfig;
  private state: PropAccountState;
  private historicalDailyProfits: number[] = [];
  private onBreachCallback: ((type: 'DAILY_LOSS' | 'MAX_DRAWDOWN', message: string) => void) | null = null;

  constructor(
    config: PropAccountConfig = {
      accountName: '50K_APEX_FUTURES_01',
      firmName: 'Apex',
      initialBalance: 50000,
      profitTarget: 3000,
      maxTrailingDrawdown: 2500,
      dailyLossLimit: 1000,
      maxContractsMini: 5,
      maxContractsMicro: 50,
      trailingMode: 'INTRADAY_PEAK',
      consistencyTargetPercent: 30,
    }
  ) {
    this.config = config;
    const initialPeak = config.initialBalance;
    const initialThreshold = initialPeak - config.maxTrailingDrawdown;

    this.state = {
      balance: config.initialBalance,
      equity: config.initialBalance,
      peakHighWaterMark: initialPeak,
      trailingThreshold: initialThreshold,
      trailingBufferRemaining: config.maxTrailingDrawdown,
      trailingBufferPercent: 100,
      todayPnL: 0,
      dailyLossRemaining: config.dailyLossLimit,
      dailyLossPercent: 100,
      profitTargetProgressPercent: 0,
      highestDayProfit: 0,
      consistencyPercent: 0,
      isDailyLossBreached: false,
      isDrawdownBreached: false,
      isLockedOut: false,
      openContractsCount: 0,
    };

    if (process.env.DEMO === '1') {
      this.seedDemo();
    }
  }

  public seedDemo() {
    this.historicalDailyProfits = [650, 420, 890, -150];
    this.state.todayPnL = 350.0;
    this.state.dailyLossRemaining = this.config.dailyLossLimit + 350.0;
    this.state.dailyLossPercent = 100;
    this.state.profitTargetProgressPercent = (350 / this.config.profitTarget) * 100;
    this.state.highestDayProfit = 890;
    this.state.consistencyPercent = 35.6;
    this.recalculate();
  }

  public rollDay() {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    this.historicalDailyProfits.push(round2(this.state.todayPnL));
    if (this.historicalDailyProfits.length > 30) this.historicalDailyProfits.shift();
    this.state.todayPnL = 0;
    this.state.isDailyLossBreached = false;
    if (!this.state.isDrawdownBreached) {
      this.state.isLockedOut = false;
    }
    this.recalculate();
  }

  public setCallback(callback: (type: 'DAILY_LOSS' | 'MAX_DRAWDOWN', message: string) => void) {
    this.onBreachCallback = callback;
  }

  public setTrailingMode(mode: TrailingMode) {
    this.config.trailingMode = mode;
    this.recalculate();
  }

  public setConfig(newConfig: Partial<PropAccountConfig>) {
    Object.assign(this.config, newConfig);
    if (newConfig.maxTrailingDrawdown !== undefined) {
      this.state.trailingThreshold = this.state.peakHighWaterMark - newConfig.maxTrailingDrawdown;
    }
    this.recalculate();
  }

  public updateEquity(unrealizedPnL: number, openContracts = 0) {
    this.state.openContractsCount = openContracts;
    this.state.equity = this.state.balance + unrealizedPnL;

    // Update Peak High Water Mark
    if (this.config.trailingMode === 'INTRADAY_PEAK') {
      if (this.state.equity > this.state.peakHighWaterMark) {
        this.state.peakHighWaterMark = this.state.equity;
        // Trailing threshold moves up with peak until it reaches initialBalance + 100
        const newThreshold = Math.min(
          this.config.initialBalance + 100,
          this.state.peakHighWaterMark - this.config.maxTrailingDrawdown
        );
        this.state.trailingThreshold = newThreshold;
      }
    }

    this.recalculate();
  }

  public recordClosedTrade(pnl: number) {
    this.state.balance += pnl;
    this.state.todayPnL += pnl;
    this.state.equity = this.state.balance;

    if (this.config.trailingMode === 'END_OF_DAY') {
      if (this.state.balance > this.state.peakHighWaterMark) {
        this.state.peakHighWaterMark = this.state.balance;
        const newThreshold = Math.min(
          this.config.initialBalance + 100,
          this.state.peakHighWaterMark - this.config.maxTrailingDrawdown
        );
        this.state.trailingThreshold = newThreshold;
      }
    }

    this.recalculate();
  }

  private recalculate() {
    // 1. Trailing Drawdown Buffer
    const buffer = this.state.equity - this.state.trailingThreshold;
    this.state.trailingBufferRemaining = Math.max(0, Math.round(buffer * 100) / 100);
    this.state.trailingBufferPercent = Math.max(
      0,
      Math.min(100, (this.state.trailingBufferRemaining / this.config.maxTrailingDrawdown) * 100)
    );

    // 2. Daily Loss Limit Buffer
    const dailyLossUsed = Math.max(0, -this.state.todayPnL);
    this.state.dailyLossRemaining = Math.max(0, this.config.dailyLossLimit - dailyLossUsed);
    this.state.dailyLossPercent = Math.max(
      0,
      Math.min(100, (this.state.dailyLossRemaining / this.config.dailyLossLimit) * 100)
    );

    // 3. Profit Target Progress
    const totalProfit = Math.max(0, this.state.balance - this.config.initialBalance);
    this.state.profitTargetProgressPercent = Math.min(100, (totalProfit / this.config.profitTarget) * 100);

    // 4. Consistency Rule (Highest single day profit / Total profit)
    const allProfits = [...this.historicalDailyProfits, Math.max(0, this.state.todayPnL)];
    const highestDay = Math.max(...allProfits, 0);
    const sumProfits = allProfits.reduce((a, b) => a + Math.max(0, b), 0);
    this.state.highestDayProfit = highestDay;
    this.state.consistencyPercent = sumProfits > 0 ? Math.round((highestDay / sumProfits) * 1000) / 10 : 0;

    // Check Breaches
    if (this.state.trailingBufferRemaining <= 0) {
      if (!this.state.isDrawdownBreached) {
        this.state.isDrawdownBreached = true;
        this.state.isLockedOut = true;
        this.onBreachCallback?.('MAX_DRAWDOWN', `Max Trailing Drawdown Breached! Account Failed.`);
      }
    }

    if (this.state.dailyLossRemaining <= 0) {
      if (!this.state.isDailyLossBreached) {
        this.state.isDailyLossBreached = true;
        this.state.isLockedOut = true;
        this.onBreachCallback?.('DAILY_LOSS', `Daily Loss Limit Breached! Auto-flatten triggered.`);
      }
    }
  }

  public resetAccount() {
    const initialPeak = this.config.initialBalance;
    const initialThreshold = initialPeak - this.config.maxTrailingDrawdown;

    this.state = {
      balance: this.config.initialBalance,
      equity: this.config.initialBalance,
      peakHighWaterMark: initialPeak,
      trailingThreshold: initialThreshold,
      trailingBufferRemaining: this.config.maxTrailingDrawdown,
      trailingBufferPercent: 100,
      todayPnL: 0,
      dailyLossRemaining: this.config.dailyLossLimit,
      dailyLossPercent: 100,
      profitTargetProgressPercent: 0,
      highestDayProfit: 0,
      consistencyPercent: 0,
      isDailyLossBreached: false,
      isDrawdownBreached: false,
      isLockedOut: false,
      openContractsCount: 0,
    };
    this.historicalDailyProfits = [];
    this.recalculate();
  }

  public validateOrder(symbol: string, contracts: number, pendingContracts = 0): { allowed: boolean; reason?: string } {
    if (this.state.isLockedOut) {
      return { allowed: false, reason: 'Trading is LOCKED OUT due to risk rule breach.' };
    }

    const isMicro = symbol.startsWith('M');
    const maxAllowed = isMicro ? this.config.maxContractsMicro : this.config.maxContractsMini;

    if (this.state.openContractsCount + pendingContracts + contracts > maxAllowed) {
      return {
        allowed: false,
        reason: `Contract limit exceeded! Max allowed: ${maxAllowed} ${isMicro ? 'Micros' : 'Minis'}.`,
      };
    }

    return { allowed: true };
  }

  public getState(): PropAccountState {
    return this.state;
  }

  public getConfig(): PropAccountConfig {
    return this.config;
  }
}
