import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Search, Star, X } from 'lucide-react';
import { InstrumentOption } from '../Navigation/SymbolDropdown';
import { loadFavoriteSymbols, toggleFavoriteSymbol } from '../../services/symbolPrefs';
import { deepchartApi, WatchlistQuote } from '../../services/api';

interface MarketWatchProps {
  instruments: InstrumentOption[];
  currentSymbol: string;
  /** Live price of the active symbol (streamed by the chart session). */
  currentPrice?: number;
  decimals?: number;
  onSelectSymbol: (symbol: string) => void;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 15_000;
const POLL_BUDGET = 8;

/**
 * Watchlist panel (TradingView's right-hand list).
 *
 * Prices come from two honest sources only: the chart session for the symbol you are watching, and — when
 * the operator enables the metered quote board — cached last-trade quotes for up to 8 rows. No row ever
 * shows a number the terminal did not actually receive, and every quote carries its age.
 */
export const MarketWatch: React.FC<MarketWatchProps> = ({
  instruments,
  currentSymbol,
  currentPrice,
  decimals = 2,
  onSelectSymbol,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => loadFavoriteSymbols());
  const [quotes, setQuotes] = useState<Record<string, WatchlistQuote>>({});
  const [boardEnabled, setBoardEnabled] = useState<boolean | null>(null);
  const [boardHint, setBoardHint] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const pollRef = useRef<number | null>(null);
  const quotesRef = useRef<Record<string, WatchlistQuote>>({});
  // Ages are computed outside render (poll callback + a slow ticker) so rendering stays pure.
  const [quoteAges, setQuoteAges] = useState<Record<string, string>>({});

  const computeAges = (source: Record<string, WatchlistQuote>, now: number): Record<string, string> => {
    const next: Record<string, string> = {};
    for (const [symbol, quote] of Object.entries(source)) {
      if (quote.stale) {
        next[symbol] = 'stale';
        continue;
      }
      const ageSec = Math.max(0, Math.round((now - quote.ts) / 1000));
      next[symbol] = ageSec < 90 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`;
    }
    return next;
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteAges(computeAges(quotesRef.current, Date.now()));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return instruments
      .filter((inst) =>
        !needle ||
        inst.symbol.toLowerCase().includes(needle) ||
        inst.name.toLowerCase().includes(needle) ||
        (inst.exchange ?? '').toLowerCase().includes(needle)
      )
      .sort((a, b) => {
        const rank = (symbol: string) => (favorites.includes(symbol) ? 0 : symbol === currentSymbol ? 1 : 2);
        return rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol);
      });
  }, [instruments, query, favorites, currentSymbol]);

  // Poll the quote board for the rows that are actually on screen (capped) instead of the whole catalogue.
  useEffect(() => {
    if (!polling || boardEnabled === false) return;
    let cancelled = false;

    const load = async () => {
      const targets = rows.slice(0, POLL_BUDGET).map((row) => row.symbol);
      if (targets.length === 0) return;
      try {
        const response = await deepchartApi.getQuotes(targets);
        if (cancelled) return;
        setBoardEnabled(response.enabled);
        setBoardHint(response.hint ?? null);
        if (response.enabled) {
          setQuotes((prev) => {
            const next = { ...prev };
            for (const quote of response.quotes) next[quote.symbol] = quote;
            quotesRef.current = next;
            return next;
          });
          setQuoteAges(computeAges(
            Object.fromEntries(response.quotes.map((quote) => [quote.symbol, quote])),
            Date.now()
          ));
        }
      } catch {
        /* a failed poll just leaves the previous values in place, flagged by their age */
      }
    };

    void load();
    pollRef.current = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [rows, polling, boardEnabled]);

  const feedTone = (inst: InstrumentOption): { label: string; className: string } => {
    if (inst.isLive || inst.feedStatus === 'LIVE') return { label: 'live', className: 'text-[#089981]' };
    if (inst.feedStatus === 'CONNECTING') return { label: 'connecting', className: 'text-amber-400' };
    if (inst.feedConfigured === false) return { label: 'no vendor', className: 'text-[#787B86]' };
    if (inst.feedStatus === 'ERROR') return { label: 'error', className: 'text-[#F23645]' };
    if (inst.subscribed) return { label: 'no data', className: 'text-[#787B86]' };
    return { label: 'idle', className: 'text-[#787B86]' };
  };

  const quoteAge = (symbol: string): string | null => quoteAges[symbol] ?? null;

  return (
    <aside className="tv-watchlist" aria-label="Watchlist">
      <div className="tv-watchlist-header">
        <span>Watchlist</span>
        <div className="flex items-center gap-1">
          <span
            className="text-[10px] font-normal text-[#787B86]"
            title={
              boardEnabled === false
                ? boardHint || 'Quote board đang tắt trên server'
                : boardEnabled === true
                  ? `Giá lấy từ vendor, cache ${POLL_INTERVAL_MS / 1000}s/lần, tối đa ${POLL_BUDGET} mã`
                  : 'Đang kiểm tra quote board…'
            }
          >
            {rows.length}
          </span>
          <button
            className="tv-rail-btn h-6 w-6"
            aria-pressed={polling}
            onClick={() => setPolling((prev) => !prev)}
            title={polling ? 'Tạm dừng cập nhật giá watchlist' : 'Bật cập nhật giá watchlist'}
            aria-label="Toggle watchlist polling"
          >
            {polling ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button className="tv-rail-btn h-6 w-6" onClick={onClose} aria-label="Close watchlist" title="Đóng watchlist">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="p-2 border-b border-[#2A2E39]">
        <label className="flex items-center gap-2 rounded-[5px] border border-[#2A2E39] bg-[#131722] px-2">
          <Search size={12} className="text-[#787B86]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter symbols"
            aria-label="Filter watchlist"
            className="w-full h-7 bg-transparent text-[12px] outline-none placeholder:text-[#787B86]"
          />
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
        {rows.map((inst) => {
          const tone = feedTone(inst);
          const isActive = inst.symbol === currentSymbol;
          const isFavorite = favorites.includes(inst.symbol);
          return (
            <div key={inst.symbol} className="flex items-stretch gap-0.5 group/row">
              <button
                type="button"
                className="tv-watchlist-row"
                data-active={isActive}
                onClick={() => onSelectSymbol(inst.symbol)}
                title={`${inst.name} · ${inst.exchange ?? ''}`}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[12px] font-semibold text-[#D1D4DC] truncate">{inst.symbol}</span>
                  <span className="block text-[9.5px] text-[#787B86] truncate">
                    {inst.exchange} · tick {inst.tickSize}
                  </span>
                </span>
                <span className="text-right font-mono text-[11px] text-[#D1D4DC]">
                  <span className="block leading-tight">
                    {isActive && typeof currentPrice === 'number' && currentPrice > 0
                      ? currentPrice.toFixed(decimals)
                      : quotes[inst.symbol]
                        ? quotes[inst.symbol].price.toFixed(decimals)
                        : '—'}
                  </span>
                  {(isActive && currentPrice ? 'live' : quoteAge(inst.symbol)) && (
                    <span className="block text-[8.5px] leading-tight text-[#787B86]">
                      {isActive && currentPrice ? 'live' : quoteAge(inst.symbol)}
                    </span>
                  )}
                </span>
                <span className={`text-[9px] font-mono ${tone.className}`}>{tone.label}</span>
              </button>
              <button
                type="button"
                aria-label={isFavorite ? `Remove ${inst.symbol} from favourites` : `Add ${inst.symbol} to favourites`}
                aria-pressed={isFavorite}
                onClick={() => setFavorites(toggleFavoriteSymbol(inst.symbol))}
                className={`px-1 rounded transition-colors ${
                  isFavorite ? 'text-[#F5B942]' : 'text-[#363A45] opacity-0 group-hover/row:opacity-100 hover:text-[#F5B942]'
                }`}
                title={isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'}
              >
                <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-[11px] text-[#787B86]">Không có mã nào khớp “{query}”.</p>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-[#2A2E39] text-[9.5px] text-[#787B86] font-mono">
        {boardEnabled === false
          ? 'Quote board tắt · bật ENABLE_QUOTE_BOARD=1 ở server để có giá watchlist (dữ liệu tính phí)'
          : 'Mã đang xem: giá realtime · mã khác: giá vendor có cache, kèm tuổi dữ liệu'}
      </div>
    </aside>
  );
};
