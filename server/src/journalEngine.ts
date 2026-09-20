import { JournalTrade } from './types.js';

export class JournalEngine {
  private trades: JournalTrade[] = [];
  private openTrades: Map<string, JournalTrade> = new Map();
  private pointValue = 1;

  public setPointValue(v: number) {
    this.pointValue = v;
  }

  constructor() {
    if (process.env.DEMO === '1') {
      this.seedDemo();
    }
  }

  /** Sample closed trades used only for UI demos (enable with DEMO=1). */
  public seedDemo() {
    this.trades.push(
      {
        id: 'trade_seed_1',
        symbol: 'BTCUSDT',
        timestamp: Date.now() - 3600 * 1000 * 4,
        exitTimestamp: Date.now() - 3600 * 1000 * 3.8,
        side: 'LONG',
        entryPrice: 63200,
        exitPrice: 63580,
        size: 0.5,
        pnl: 190.0,
        pnlPercent: 0.6,
        fee: 6.3,
        status: 'CLOSED',
        mae: -45.0,
        mfe: 210.0,
        notes: 'Stacked Bid Imbalance at Session VAL bounce. Clear absorption.',
        imbalanceContext: '3x Stacked Bid Imbalance (450% ratio)',
      },
      {
        id: 'trade_seed_2',
        symbol: 'BTCUSDT',
        timestamp: Date.now() - 3600 * 1000 * 2,
        exitTimestamp: Date.now() - 3600 * 1000 * 1.7,
        side: 'SHORT',
        entryPrice: 63850,
        exitPrice: 63620,
        size: 0.75,
        pnl: 172.5,
        pnlPercent: 0.36,
        fee: 9.5,
        status: 'CLOSED',
        mae: -30.0,
        mfe: 195.0,
        notes: 'Passive Seller Absorption at VP POC with high negative Delta.',
        imbalanceContext: 'Single Print rejection + Unfinished High',
      }
    );
  }

  /** Wipe journal state (used by test suites and account resets). */
  public reset() {
    this.trades = [];
    this.openTrades.clear();
  }

  public openTrade(
    symbol: string,
    side: 'LONG' | 'SHORT',
    price: number,
    size: number,
    notes = '',
    imbalanceContext = ''
  ): JournalTrade {
    const trade: JournalTrade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      symbol,
      timestamp: Date.now(),
      side,
      entryPrice: price,
      size,
      fee: price * size * 0.0004, // 0.04% taker fee standard
      status: 'OPEN',
      mae: 0,
      mfe: 0,
      notes,
      imbalanceContext,
    };

    this.openTrades.set(trade.id, trade);
    this.trades.unshift(trade);
    return trade;
  }

  public updatePriceForOpenTrades(symbol: string, currentPrice: number) {
    for (const trade of this.openTrades.values()) {
      if (trade.symbol !== symbol) continue;
      const priceDiff = trade.side === 'LONG' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;
      const unrealizedPnl = priceDiff * trade.size * this.pointValue;

      // MAE: worst negative excursion
      if (unrealizedPnl < trade.mae) {
        trade.mae = Math.round(unrealizedPnl * 100) / 100;
      }
      // MFE: best positive excursion
      if (unrealizedPnl > trade.mfe) {
        trade.mfe = Math.round(unrealizedPnl * 100) / 100;
      }
    }
  }

  public closeTrade(tradeId: string, exitPrice: number): JournalTrade | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade) return null;

    trade.exitPrice = exitPrice;
    trade.exitTimestamp = Date.now();
    trade.status = 'CLOSED';

    const priceDiff = trade.side === 'LONG' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
    trade.pnl = Math.round((priceDiff * trade.size * this.pointValue - trade.fee) * 100) / 100;
    trade.pnlPercent = Math.round(((priceDiff / trade.entryPrice) * 100) * 100) / 100;

    this.openTrades.delete(tradeId);
    return trade;
  }

  public closeAllTrades(symbol: string, currentPrice: number): JournalTrade[] {
    const closed: JournalTrade[] = [];
    for (const [id, trade] of this.openTrades.entries()) {
      if (trade.symbol === symbol) {
        const c = this.closeTrade(id, currentPrice);
        if (c) closed.push(c);
      }
    }
    return closed;
  }

  public getTrades(): JournalTrade[] {
    return this.trades;
  }

  public getStats() {
    const closedTrades = this.trades.filter((t) => t.status === 'CLOSED');
    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0);
    const losingTrades = closedTrades.filter((t) => (t.pnl || 0) <= 0);

    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;

    return {
      totalTrades,
      winRate: Math.round(winRate * 10) / 10,
      totalPnl: Math.round(totalPnl * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
    };
  }
}
