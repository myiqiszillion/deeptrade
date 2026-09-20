import React, { useState } from 'react';
import { Info, X } from 'lucide-react';

const STORAGE_KEY = 'deepchart.onboarding.v1';

interface OnboardingCardProps {
  symbol: string;
}

/**
 * First-run guidance. A public/free tool is opened by people who have never seen an
 * orderflow terminal, so the first thing they get is a 30-second primer on what to click
 * and — importantly — which data is real, which is delayed and which is simulated.
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
            <span>Welcome to DeepChart — 30-second primer</span>
          </div>
          <button onClick={dismiss} className="text-slate-400 hover:text-white" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-slate-300 max-h-[62vh] overflow-y-auto">
          <section>
            <div className="font-bold text-slate-100 mb-1">1 · Placing orders (simulated)</div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li>Click any price in the <b>DOM LADDER</b> to rest a <b>LIMIT</b> order — manage it in <b>WORKING ORDERS</b>.</li>
              <li>Hotkeys: <b>A</b> buy · <b>S</b> sell · <b>D</b> flatten · <b>W</b> reverse.</li>
              <li>Fills happen inside DeepChart only — no broker, no real money.</li>
            </ul>
          </section>

          <section>
            <div className="font-bold text-slate-100 mb-1">2 · Prop-firm guardrails (top HUD)</div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li>Trailing drawdown (Intraday Peak / End of Day), daily loss limit, contract cap, consistency rule.</li>
              <li>Breaching DLL/drawdown auto-flattens and locks the account — press <b>RESET ACCOUNT</b> to unlock.</li>
            </ul>
          </section>

          <section>
            <div className="font-bold text-slate-100 mb-1">3 · What you are looking at (real data only)</div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li>
                <b>BTCUSDT</b> — real-time prices, real depth and real historical trades (Binance). Everything
                you see here is measured, not invented.
              </li>
              <li>
                <b>Futures / indices ({symbol})</b> — no licensed real-time vendor is configured, so these
                instruments report <b>FEED: UNAVAILABLE</b>. DeepChart will not show reconstructed ticks,
                synthetic depth, a fabricated footprint or an invented volume profile.
              </li>
              <li>
                <b>GEX</b> — real gamma and open interest from CBOE’s free delayed chain (≈15 min); shows
                UNAVAILABLE when the chain cannot be fetched.
              </li>
              <li>
                <b>Options flow</b> — UNAVAILABLE until a real flow provider is wired.
              </li>
            </ul>
          </section>

          <p className="text-[10px] text-slate-500 border-t border-brand-border pt-2">
            Educational tool · simulated executions · not investment advice. The terminal targets
            screens ≥ 1280px wide.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-brand-border bg-brand-surfaceHover flex justify-end">
          <button
            onClick={dismiss}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded"
          >
            Start trading (simulated)
          </button>
        </div>
      </div>
    </div>
  );
};
