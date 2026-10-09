import React, { useState } from 'react';
import { Info, X } from 'lucide-react';

const STORAGE_KEY = 'deepchart.onboarding.v1';

interface OnboardingCardProps {
  symbol: string;
  onClose?: () => void;
  forceVisible?: boolean;
}

/**
 * First-run guidance. Focuses on order flow analysis, reading footprint charts,
 * understanding market depth, and data source transparency.
 */
export const OnboardingCard: React.FC<OnboardingCardProps> = ({ symbol, onClose, forceVisible }) => {
  // Read the dismissal flag lazily on mount (no effect needed, avoids a cascading render).
  const [visible, setVisible] = useState(() => {
    if (forceVisible) return true;
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
    onClose?.();
  };

  if (!visible && !forceVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="w-[580px] max-w-[93vw] bg-[#0D1218] border border-[#25303A] rounded-[4px] shadow-[0_16px_40px_rgba(0,0,0,0.9)] text-xs text-[#E7EDF3]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1C2630] bg-[#111720]">
          <div className="flex items-center gap-2 font-bold text-[#E7EDF3] font-mono text-xs">
            <Info size={14} className="text-[#F5B942]" />
            <span>Welcome to DeepChart Free — 30-Second Primer</span>
          </div>
          <button onClick={dismiss} className="text-[#7F8B97] hover:text-[#E7EDF3]" title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="p-4 space-y-3.5 text-[#7F8B97] max-h-[62vh] overflow-y-auto">
          <section>
            <div className="font-bold text-[#E7EDF3] mb-1 font-mono text-xs">1 · Footprint & Microstructure (Bid × Ask)</div>
            <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed">
              <li><strong className="text-[#E7EDF3]">Footprint Bars</strong> — view actual executed market buy volume vs market sell volume at each price level.</li>
              <li><strong className="text-[#E7EDF3]">Imbalance & Stacked Imbalance</strong> — diagonal bid/ask volume ratios highlight aggressive auction imbalance.</li>
              <li><strong className="text-[#E7EDF3]">Value Areas & POC</strong> — Point of Control (POC), Value Area High/Low (VAH/VAL) and anchored VWAP show auction structure.</li>
            </ul>
          </section>

          <section>
            <div className="font-bold text-[#E7EDF3] mb-1 font-mono text-xs">2 · Market Depth & Tape (DOM & Speed of Tape)</div>
            <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed">
              <li><strong className="text-[#E7EDF3]">DOM Ladder</strong> — real-time resting liquidity across bid/ask levels, with Pulling & Stacking (P&S) delta tracking.</li>
              <li><strong className="text-[#E7EDF3]">Speed of Tape</strong> — transactions per second (TPS), volume acceleration, and buyer/seller ratio.</li>
              <li><strong className="text-[#E7EDF3]">Large Trades & Absorptions</strong> — whale trades and iceberg/absorption signals detected by order flow rules.</li>
            </ul>
          </section>

          <section>
            <div className="font-bold text-[#E7EDF3] mb-1 font-mono text-xs">3 · Data Integrity (Real Data Only)</div>
            <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed">
              <li>
                <strong className="text-[#E7EDF3]">CME Futures ({symbol})</strong> — real-time trades, real depth and historical backfill from CME Globex MDP 3.0 via Databento / Tradovate. DeepChart never fabricates synthetic ticks or fake footprint bars.
              </li>
              <li>
                <strong className="text-[#E7EDF3]">GEX Profile</strong> — Gamma Exposure and open interest from CBOE delayed options chain.
              </li>
            </ul>
          </section>

          <p className="text-[10px] text-[#4E5965] border-t border-[#1C2630] pt-2">
            Free order flow analysis terminal · not investment advice. Best experienced on screens ≥ 1280px wide.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-[#1C2630] bg-[#111720] flex justify-end">
          <button
            onClick={dismiss}
            className="terminal-btn active font-semibold text-xs h-7 px-4 bg-[#1C2630] hover:bg-[#25303A] text-[#E7EDF3] border border-[#25303A]"
          >
            Explore Order Flow Charts
          </button>
        </div>
      </div>
    </div>
  );
};
