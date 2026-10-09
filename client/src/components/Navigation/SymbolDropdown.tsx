import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Check, ChevronDown, Search, Star, X } from 'lucide-react';
import { FuturesInstrument, InstrumentCategory } from '../../types';
import { loadFavoriteSymbols, loadRecentSymbols, toggleFavoriteSymbol } from '../../services/symbolPrefs';

export interface InstrumentOption {
  symbol: string;
  name: string;
  exchange?: string;
  category?: InstrumentCategory | string;
  tickSize?: number;
  pointValue?: number;
  dayTradingMargin?: number;
  isLive?: boolean;
  feedStatus?: 'LIVE' | 'CONNECTING' | 'IDLE' | 'UNAVAILABLE' | 'ERROR' | string;
  /** True when the server already tracks a market context for this symbol (someone subscribed). */
  subscribed?: boolean;
  /** False when no vendor is configured at all (FUTURES_PROVIDER=none): nothing can ever go live. */
  feedConfigured?: boolean;
}

/** Tab order for the picker; categories not listed here are appended after these. */
const CATEGORY_ORDER: string[] = ['INDEX', 'METALS', 'ENERGY', 'RATES', 'FX', 'AGRICULTURE', 'CRYPTO', 'COMMODITY', 'BOND', 'OTHER'];

const CATEGORY_LABELS: Record<string, string> = {
  ALL: 'All',
  INDEX: 'Indices',
  METALS: 'Metals',
  ENERGY: 'Energy',
  RATES: 'Rates',
  FX: 'FX',
  AGRICULTURE: 'Ags',
  CRYPTO: 'Crypto',
  COMMODITY: 'Commodity',
  BOND: 'Bonds',
  OTHER: 'Other',
  FAVORITES: 'Favourites',
};

interface SymbolDropdownProps {
  currentSymbol: string;
  currentInstrument?: FuturesInstrument;
  onSelectSymbol: (symbol: string) => void;
  feedStatus?: 'LIVE' | 'UNAVAILABLE';
  instruments?: InstrumentOption[];
}

const DEFAULT_INSTRUMENTS: InstrumentOption[] = [
  { symbol: 'ES', name: 'E-mini S&P 500', exchange: 'CME', category: 'INDEX', tickSize: 0.25, pointValue: 50, dayTradingMargin: 500 },
  { symbol: 'NQ', name: 'E-mini Nasdaq 100', exchange: 'CME', category: 'INDEX', tickSize: 0.25, pointValue: 20, dayTradingMargin: 1000 },
  { symbol: 'MES', name: 'Micro E-mini S&P 500', exchange: 'CME', category: 'INDEX', tickSize: 0.25, pointValue: 5, dayTradingMargin: 50 },
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq 100', exchange: 'CME', category: 'INDEX', tickSize: 0.25, pointValue: 2, dayTradingMargin: 100 },
  { symbol: 'YM', name: 'E-mini Dow Jones', exchange: 'CBOT', category: 'INDEX', tickSize: 1.0, pointValue: 5, dayTradingMargin: 500 },
  { symbol: 'MYM', name: 'Micro E-mini Dow Jones', exchange: 'CBOT', category: 'INDEX', tickSize: 1.0, pointValue: 0.5, dayTradingMargin: 50 },
  { symbol: 'RTY', name: 'E-mini Russell 2000', exchange: 'CME', category: 'INDEX', tickSize: 0.1, pointValue: 50, dayTradingMargin: 500 },
  { symbol: 'M2K', name: 'Micro Russell 2000', exchange: 'CME', category: 'INDEX', tickSize: 0.1, pointValue: 5, dayTradingMargin: 50 },
  { symbol: 'GC', name: 'Gold Futures', exchange: 'COMEX', category: 'COMMODITY', tickSize: 0.1, pointValue: 100, dayTradingMargin: 1000 },
  { symbol: 'MGC', name: 'Micro Gold Futures', exchange: 'COMEX', category: 'COMMODITY', tickSize: 0.1, pointValue: 10, dayTradingMargin: 100 },
  { symbol: 'CL', name: 'Crude Oil', exchange: 'NYMEX', category: 'ENERGY', tickSize: 0.01, pointValue: 1000, dayTradingMargin: 1000 },
  { symbol: 'MCL', name: 'Micro WTI Crude Oil', exchange: 'NYMEX', category: 'ENERGY', tickSize: 0.01, pointValue: 100, dayTradingMargin: 100 },
  { symbol: 'NG', name: 'Natural Gas', exchange: 'NYMEX', category: 'ENERGY', tickSize: 0.001, pointValue: 10000, dayTradingMargin: 1000 },
];

export const SymbolDropdown: React.FC<SymbolDropdownProps> = ({
  currentSymbol,
  currentInstrument,
  onSelectSymbol,
  feedStatus,
  instruments,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [favorites, setFavorites] = useState<string[]>(() => loadFavoriteSymbols());
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Auto-focus search input
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Escape closes the picker. Ctrl+K belongs to the command palette (one owner per shortcut).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const instrumentList = useMemo(() => {
    return instruments && instruments.length > 0 ? instruments : DEFAULT_INSTRUMENTS;
  }, [instruments]);

  // Tabs follow the data: adding instruments (or EXTRA_INSTRUMENTS on the server) never needs a UI change.
  const categoryTabs = useMemo(() => {
    const present = new Set<string>();
    for (const item of instrumentList) {
      if (item.category) present.add(String(item.category).toUpperCase());
    }
    const ordered = CATEGORY_ORDER.filter((cat) => present.has(cat));
    const extras = Array.from(present)
      .filter((cat) => !CATEGORY_ORDER.includes(cat))
      .sort();
    const tabs = ['ALL', ...ordered, ...extras];
    // Only offer the Favourites tab once something is actually starred.
    return favorites.length > 0 ? ['FAVORITES', ...tabs] : tabs;
  }, [instrumentList, favorites.length]);

  /** Number of instruments behind each tab — tells you at a glance where a market lives. */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: instrumentList.length, FAVORITES: 0 };
    for (const item of instrumentList) {
      const key = String(item.category || 'OTHER').toUpperCase();
      counts[key] = (counts[key] || 0) + 1;
      if (favorites.includes(item.symbol)) counts.FAVORITES += 1;
    }
    return counts;
  }, [instrumentList, favorites]);

  const externalSymbols = useMemo(() => new Set(instrumentList.map((item) => item.symbol)), [instrumentList]);

  const filteredInstruments = useMemo(() => {
    const starred = favorites.filter((symbol) => externalSymbols.has(symbol));
    const recent = loadRecentSymbols().filter((symbol) => externalSymbols.has(symbol));
    return instrumentList
      .filter((item) => {
        const matchesCategory =
          activeCategory === 'ALL' ||
          (activeCategory === 'FAVORITES' ? favorites.includes(item.symbol) : item.category === activeCategory);
        const query = searchQuery.trim().toLowerCase();
        const matchesSearch =
          !query ||
          item.symbol.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query) ||
          (item.exchange && item.exchange.toLowerCase().includes(query));
        return matchesCategory && matchesSearch;
      })
      .sort((a, b) => {
        if (activeCategory !== 'ALL' || searchQuery.trim()) return 0;
        // Unfiltered view: the markets you touched most recently float to the top.
        const rank = (symbol: string) => (starred.includes(symbol) ? 0 : recent.includes(symbol) ? 1 : 2);
        return rank(a.symbol) - rank(b.symbol);
      });
  }, [instrumentList, searchQuery, activeCategory, favorites, externalSymbols]);

  const activeItem =
    instrumentList.find((i) => i.symbol === currentSymbol) || {
      symbol: currentSymbol,
      name: currentInstrument?.name || currentSymbol,
      exchange: currentInstrument?.exchange || 'CME',
      tickSize: currentInstrument?.tickSize || 0.25,
      pointValue: currentInstrument?.pointValue || 50,
      isLive: feedStatus === 'LIVE',
      feedStatus: feedStatus,
    };

  return (
    <div ref={dropdownRef} className="relative z-30 select-none">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 h-8 px-2.5 rounded-[3px] bg-[#10151C] hover:bg-[#141A23] border border-[#1C2630] hover:border-[#25303A] transition-colors text-left group"
        title="Switch Instrument Contract (Ctrl+K)"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-1.5 font-mono">
          <span className="font-bold text-xs text-[#E7EDF3] tracking-tight">
            {activeItem.symbol}
          </span>
          <span className="text-[#4E5965] font-normal text-xs">·</span>
          <span className="hidden sm:inline text-[11px] font-medium text-[#A0AEC0] truncate max-w-[180px]">
            {activeItem.name}
          </span>
        </div>
        <ChevronDown
          size={12}
          className={`text-[#7F8B97] group-hover:text-[#E7EDF3] transition-transform duration-150 ml-0.5 ${
            isOpen ? 'rotate-180 text-[#22D3EE]' : ''
          }`}
        />
      </button>

      {/* Floating Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-80 sm:w-96 rounded bg-[#0D1218] border border-[#25303A] shadow-[0_12px_32px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-xs text-[#E7EDF3] animate-in fade-in duration-100">
          {/* Search Header */}
          <div className="p-2 border-b border-[#1C2630] bg-[#111720] flex items-center gap-2">
            <Search size={13} className="text-[#7F8B97] shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search symbol (ES, NQ, MES, Gold, Crude)..."
              className="w-full bg-transparent border-none outline-none text-[#E7EDF3] text-xs placeholder:text-[#4E5965] font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-[#7F8B97] hover:text-[#E7EDF3] p-0.5"
              >
                <X size={12} />
              </button>
            )}
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#10151C] text-[#7F8B97] font-mono shrink-0 border border-[#1C2630]">
              ESC
            </span>
          </div>

          {/* Category Tabs (derived from the instrument list, with counts) */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#1C2630] bg-[#0B0F14] text-[10px] overflow-x-auto">
            {categoryTabs.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                title={
                  cat === 'FAVORITES'
                    ? 'Your starred instruments'
                    : `${categoryCounts[cat] ?? 0} instrument(s) in ${CATEGORY_LABELS[cat] || cat}`
                }
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? 'bg-[#1C2630] text-[#E7EDF3]'
                    : 'text-[#7F8B97] hover:text-[#E7EDF3]'
                }`}
              >
                {cat === 'FAVORITES' && <Star size={10} className="text-[#F5B942]" fill="currentColor" />}
                <span>{CATEGORY_LABELS[cat] || cat}</span>
                <span className="text-[#4E5965]">{categoryCounts[cat] ?? 0}</span>
              </button>
            ))}
          </div>

          {/* Instruments List */}
          <div className="max-h-64 overflow-y-auto divide-y divide-[#1C2630]/40 p-1">
            {filteredInstruments.map((inst) => {
              const isSelected = inst.symbol === currentSymbol;
              const isFavorite = favorites.includes(inst.symbol);
              return (
                <div key={inst.symbol} className="flex items-stretch gap-0.5 group/row">
                <button
                  onClick={() => {
                    onSelectSymbol(inst.symbol);
                    setIsOpen(false);
                  }}
                  className={`flex-1 min-w-0 flex items-center justify-between p-1.5 rounded transition-colors text-left ${
                    isSelected
                      ? 'bg-[#161E28] border border-[#25303A] text-white'
                      : 'hover:bg-[#111720] text-[#7F8B97] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-7 h-7 rounded flex items-center justify-center font-bold text-xs font-mono shrink-0 border ${
                        isSelected
                          ? 'bg-[#10151C] text-[#22D3EE] border-[#22D3EE]/40'
                          : 'bg-[#10151C] text-[#E7EDF3] border-[#1C2630]'
                      }`}
                    >
                      {inst.symbol}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-[#E7EDF3] truncate">{inst.name}</span>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-[#10151C] text-[#7F8B97] font-mono">
                          {inst.exchange}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#4E5965] font-mono flex items-center gap-2">
                        <span>${inst.pointValue}/pt</span>
                        <span>·</span>
                        <span>Tick: {inst.tickSize}</span>
                        {inst.dayTradingMargin && (
                          <>
                            <span>·</span>
                            <span className="text-[#19C37D]/80">${inst.dayTradingMargin} margin</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pl-2">
                    {inst.isLive || inst.feedStatus === 'LIVE' ? (
                      <span
                        className="flex items-center gap-1 text-[9px] text-[#19C37D] font-mono font-medium px-1.5 py-0.2 rounded bg-[#19C37D]/10 border border-[#19C37D]/20"
                        title="Đang có dữ liệu realtime đã kiểm định cho mã này"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#19C37D]" />
                        <span>LIVE</span>
                      </span>
                    ) : inst.feedStatus === 'CONNECTING' ? (
                      <span
                        className="flex items-center gap-1 text-[9px] text-amber-400 font-mono font-medium px-1.5 py-0.2 rounded bg-amber-400/10 border border-amber-400/20"
                        title="Đang bắt tay với vendor cho mã này (đã subscribe)"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span>CONNECTING</span>
                      </span>
                    ) : inst.feedStatus === 'ERROR' ? (
                      <span
                        className="flex items-center gap-1 text-[9px] text-[#F05252] font-mono font-medium px-1.5 py-0.2 rounded bg-[#F05252]/10 border border-[#F05252]/25"
                        title="Feed lỗi — mở Diagnostics để xem lý do"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#F05252]" />
                        <span>ERROR</span>
                      </span>
                    ) : inst.subscribed ? (
                      <span
                        className="flex items-center gap-1 text-[9px] text-[#7F8B97] font-mono font-medium px-1.5 py-0.2 rounded bg-[#10151C] border border-[#1C2630]"
                        title="Đã subscribe nhưng chưa có tick hợp lệ (vendor chưa gửi dữ liệu)"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        <span>NO DATA</span>
                      </span>
                    ) : inst.feedConfigured === false ? (
                      <span
                        className="flex items-center gap-1 text-[9px] text-[#7F8B97] font-mono font-medium px-1.5 py-0.2 rounded bg-[#10151C] border border-[#1C2630]"
                        title="Server chưa cấu hình vendor dữ liệu (FUTURES_PROVIDER=none) — không thể có realtime"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        <span>NO VENDOR</span>
                      </span>
                    ) : (
                      <span
                        className="flex items-center gap-1 text-[9px] text-[#7F8B97] font-mono font-medium px-1.5 py-0.2 rounded bg-[#10151C] border border-[#1C2630]"
                        title="Chưa kết nối: server bật feed theo nhu cầu — chọn mã này để bắt đầu"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        <span>IDLE</span>
                      </span>
                    )}
                    {isSelected && <Check size={13} className="text-[#22D3EE]" />}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={isFavorite ? `Remove ${inst.symbol} from favourites` : `Add ${inst.symbol} to favourites`}
                  aria-pressed={isFavorite}
                  title={isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'}
                  onClick={() => setFavorites(toggleFavoriteSymbol(inst.symbol))}
                  className={`px-1.5 rounded transition-colors ${
                    isFavorite
                      ? 'text-[#F5B942]'
                      : 'text-[#3A4756] opacity-0 group-hover/row:opacity-100 hover:text-[#F5B942]'
                  }`}
                >
                  <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
                </button>
                </div>
              );
            })}

            {filteredInstruments.length === 0 && (
              <div className="p-4 text-center text-[#7F8B97] text-xs">
                No matching futures instrument for "{searchQuery}"
              </div>
            )}
          </div>

          {/* Quick Footer: what the per-instrument badges mean */}
          <div className="px-2.5 py-1 bg-[#080B0F] border-t border-[#1C2630] flex items-center justify-between gap-2 text-[9.5px] text-[#4E5965] font-mono">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#19C37D]" /> live
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> connecting
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" /> idle (chưa subscribe)
              </span>
              <span className="hidden xl:inline">· chọn một mã để server bật feed theo nhu cầu</span>
            </span>
            <span className="shrink-0">CME Globex · MDP 3.0</span>
          </div>
        </div>
      )}
    </div>
  );
};
