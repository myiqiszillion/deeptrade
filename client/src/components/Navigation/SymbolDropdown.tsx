import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { FuturesInstrument } from '../../types';

export interface InstrumentOption {
  symbol: string;
  name: string;
  exchange?: string;
  category?: 'INDEX' | 'COMMODITY' | 'ENERGY' | 'BOND' | string;
  tickSize?: number;
  pointValue?: number;
  dayTradingMargin?: number;
  isLive?: boolean;
  feedStatus?: 'LIVE' | 'CONNECTING' | 'UNAVAILABLE' | string;
}

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
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'INDEX' | 'COMMODITY' | 'ENERGY'>('ALL');
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

  // Global hotkey Ctrl+K to toggle symbol search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const instrumentList = useMemo(() => {
    return instruments && instruments.length > 0 ? instruments : DEFAULT_INSTRUMENTS;
  }, [instruments]);

  const filteredInstruments = useMemo(() => {
    return instrumentList.filter((item) => {
      const matchesCategory = activeCategory === 'ALL' || item.category === activeCategory;
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        item.symbol.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        (item.exchange && item.exchange.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [instrumentList, searchQuery, activeCategory]);

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

          {/* Category Tabs */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#1C2630] bg-[#0B0F14] text-[10px]">
            {(['ALL', 'INDEX', 'COMMODITY', 'ENERGY'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2 py-0.5 rounded font-mono font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-[#1C2630] text-[#E7EDF3]'
                    : 'text-[#7F8B97] hover:text-[#E7EDF3]'
                }`}
              >
                {cat === 'ALL' ? 'All' : cat === 'INDEX' ? 'Indices' : cat === 'COMMODITY' ? 'Metals' : 'Energy'}
              </button>
            ))}
          </div>

          {/* Instruments List */}
          <div className="max-h-64 overflow-y-auto divide-y divide-[#1C2630]/40 p-1">
            {filteredInstruments.map((inst) => {
              const isSelected = inst.symbol === currentSymbol;
              return (
                <button
                  key={inst.symbol}
                  onClick={() => {
                    onSelectSymbol(inst.symbol);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-1.5 rounded transition-colors text-left group ${
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
                      <span className="flex items-center gap-1 text-[9px] text-[#19C37D] font-mono font-medium px-1.5 py-0.2 rounded bg-[#19C37D]/10 border border-[#19C37D]/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#19C37D]" />
                        <span>LIVE</span>
                      </span>
                    ) : inst.feedStatus === 'CONNECTING' ? (
                      <span className="flex items-center gap-1 text-[9px] text-amber-400 font-mono font-medium px-1.5 py-0.2 rounded bg-amber-400/10 border border-amber-400/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span>CONNECTING</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[9px] text-[#7F8B97] font-mono font-medium px-1.5 py-0.2 rounded bg-[#10151C] border border-[#1C2630]">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        <span>UNAVAILABLE</span>
                      </span>
                    )}
                    {isSelected && <Check size={13} className="text-[#22D3EE]" />}
                  </div>
                </button>
              );
            })}

            {filteredInstruments.length === 0 && (
              <div className="p-4 text-center text-[#7F8B97] text-xs">
                No matching futures instrument for "{searchQuery}"
              </div>
            )}
          </div>

          {/* Quick Footer hint */}
          <div className="px-2.5 py-1 bg-[#080B0F] border-t border-[#1C2630] flex items-center justify-between text-[10px] text-[#4E5965] font-mono">
            <span>CME Globex · MDP 3.0 Realtime Feeds</span>
            <span>Ctrl+K</span>
          </div>
        </div>
      )}
    </div>
  );
};
