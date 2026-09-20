import React, { useState } from 'react';
import { Info, X } from 'lucide-react';

const STORAGE_KEY = 'deepchart.onboarding.v1';

interface OnboardingCardProps {
  symbol: string;
}

/**
 * First-run guidance. Focuses on order flow analysis, reading footprint charts,
 * understanding market depth, and data source transparency.
 */
export const OnboardingCard: React.FC<OnboardingCardProps> = ({ symbol }) => {
  // Read the dismissal flag lazily on mount (no effect needed, avoids a cascading render).
  const [visible, setVisible] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== 'dismissed';
    } catch {
      return true; // private mode / storage blocked
    }
  });

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'dismissed');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[600px] max-w-[93vw] bg-brand-surface border border-brand-border rounded-lg shadow-2xl text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border bg-brand-surfaceHover">
          <div className="flex items-center gap-2 font-bold text-slate-100">
            <Info size={15} className="text-amber-400" />
            <span>Welcome to DeepChart Free — 30-second primer</span>
          </div>
          <button onClick={dismiss} className="text-slate-400 hover:text-white" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-slate-300 max-h-[62vh] overflow-y-auto">
          <section>
            <div className="font-bold text-slate-100 mb-1">1 · Footprint & Microstructure (Bid × Ask)</div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li><b>Footprint Bars</b> — view actual executed market buy volume vs market sell volume at each price level.</li>
              <li><b>Imbalance & Stacked Imbalance</b> — diagonal bid/ask volume ratios highlight aggressive auction imbalance.</li>
              <li><b>Value Areas & POC</b> — Point of Control (POC), Value Area High/Low (VAH/VAL) and anchored VWAP show auction structure.</li>
            </ul>
          </section>

          <section>
            <div className="font-bold text-slate-100 mb-1">2 · Market Depth & Tape (DOM & Speed of Tape)</div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li><b>DOM Ladder</b> — real-time resting liquidity across bid/ask levels, with Pulling & Stacking (P&S) delta tracking.</li>
              <li><b>Speed of Tape</b> — transactions per second (TPS), volume acceleration, and buyer/seller ratio.</li>
              <li><b>Large Trades & Absorptions</b> — whale trades and iceberg/absorption signals detected by order flow rules.</li>
            </ul>
          </section>

          <section>
            <div className="font-bold text-slate-100 mb-1">3 · Data Integrity (Real data only)</div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li>
                <b>BTCUSDT</b> — real-time trades, real depth and historical backfill from Binance USD-M Futures.
              </li>
              <li>
                <b>Futures / Indices ({symbol})</b> — when a real vendor (e.g. Tradovate) is configured, streams live vendor data.
                Without credentials, it reports <b>FEED: UNAVAILABLE</b>. DeepChart never fabricates synthetic ticks or fake footprint bars.
              </li>
              <li>
                <b>GEX Profile</b> — Gamma Exposure and open interest from CBOE delayed options chain.
              </li>
            </ul>
          </section>

          <p className="text-[10px] text-slate-500 border-t border-brand-border pt-2">
            Free order flow analysis tool · not investment advice. Best experienced on screens ≥ 1280px wide.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-brand-border bg-brand-surfaceHover flex justify-end">
          <button
            onClick={dismiss}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded"
          >
            Explore Order Flow Charts
          </button>
        </div>
      </div>
    </div>
  );
};
