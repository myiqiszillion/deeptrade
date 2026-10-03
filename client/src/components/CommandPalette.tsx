import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Check, Command, Layers, LineChart, LogOut, Play, Search, Star, Terminal, Zap } from 'lucide-react';
import { InstrumentOption } from './Navigation/SymbolDropdown';
import { loadFavoriteSymbols, loadRecentSymbols } from '../services/symbolPrefs';

export type PanelId = 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | 'Darkpool' | '13F';
export type OverlayKey = 'vwap' | 'imbalances' | 'delta' | 'cvd';

export interface CommandPaletteActions {
  selectSymbol: (symbol: string) => void;
  setTimeframe: (tf: string) => void;
  setChartMode: (mode: 'footprint' | 'candles') => void;
  togglePanel: (panel: PanelId) => void;
  toggleOverlay: (key: OverlayKey) => void;
  setAutoFollow: (on: boolean) => void;
  fitView: () => void;
  openDiagnostics: () => void;
  openPrimer: () => void;
  signOut?: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  instruments: InstrumentOption[];
  currentSymbol: string;
  timeframe: string;
  chartMode: 'footprint' | 'candles';
  activePanel: PanelId | null;
  overlays: Record<OverlayKey, boolean>;
  autoFollow: boolean;
  actions: CommandPaletteActions;
}

interface PaletteEntry {
  id: string;
  section: string;
  label: string;
  hint?: string;
  keywords: string;
  badge?: string;
  icon?: React.ReactNode;
  active?: boolean;
  run: () => void;
}

// Exactly the timeframes the server can serve (server/src/marketData/marketContext.ts TIMEFRAMES):
// offering a timeframe the backend cannot aggregate would render an empty chart.
const TIMEFRAMES = ['1s', '5s', '15s', '30s', '1m', '5m', '15m', '1h'];

/**
 * Ctrl+K command palette: one place to switch instrument, timeframe, panel or overlay without hunting
 * through the toolbar. Everything is keyboard reachable (↑/↓/Enter/Esc) and entries are derived from the
 * live terminal state, so it can never offer an action the terminal cannot perform.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  instruments,
  currentSymbol,
  timeframe,
  chartMode,
  activePanel,
  overlays,
  autoFollow,
  actions,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Focus the search field when the palette opens. Callers remount via `key` so query/selection start
  // clean without a setState-in-effect (which would cascade renders).
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const list: PaletteEntry[] = [];
    const recents = loadRecentSymbols();
    const favorites = loadFavoriteSymbols();

    const instrumentEntry = (inst: InstrumentOption, section: string): PaletteEntry => ({
      id: `sym:${inst.symbol}`,
      section,
      label: inst.symbol,
      hint: [inst.name, inst.exchange].filter(Boolean).join(' · '),
      badge: inst.isLive || inst.feedStatus === 'LIVE' ? 'LIVE' : undefined,
      keywords: `${inst.symbol} ${inst.name} ${inst.exchange ?? ''} ${inst.category ?? ''}`.toLowerCase(),
      active: inst.symbol === currentSymbol,
      icon: <BarChart3 size={13} className="text-[#4E5965]" />,
      run: () => actions.selectSymbol(inst.symbol),
    });

    const bySymbol = new Map(instruments.map((i) => [i.symbol, i]));
    for (const symbol of favorites) {
      const inst = bySymbol.get(symbol);
      if (inst) {
        list.push({
          ...instrumentEntry(inst, 'Favorites'),
          icon: <Star size={13} className="text-[#F5B942]" />,
        });
      }
    }
    for (const symbol of recents) {
      const inst = bySymbol.get(symbol);
      if (inst && !favorites.includes(symbol)) list.push(instrumentEntry(inst, 'Recent'));
    }
    for (const inst of instruments) {
      if (recents.includes(inst.symbol) || favorites.includes(inst.symbol)) continue;
      list.push(instrumentEntry(inst, 'Instruments'));
    }

    for (const tf of TIMEFRAMES) {
      list.push({
        id: `tf:${tf}`,
        section: 'Chart',
        label: `Timeframe ${tf}`,
        keywords: `timeframe interval ${tf}`,
        active: timeframe === tf,
        icon: <Zap size={13} className="text-[#4E5965]" />,
        run: () => actions.setTimeframe(tf),
      });
    }
    list.push(
      {
        id: 'mode:footprint',
        section: 'Chart',
        label: 'Footprint mode',
        hint: 'Shortcut: F',
        keywords: 'footprint clusters order flow mode',
        active: chartMode === 'footprint',
        icon: <Layers size={13} className="text-[#4E5965]" />,
        run: () => actions.setChartMode('footprint'),
      },
      {
        id: 'mode:candles',
        section: 'Chart',
        label: 'Candles mode',
        hint: 'Shortcut: F',
        keywords: 'candles ohlc mode',
        active: chartMode === 'candles',
        icon: <LineChart size={13} className="text-[#4E5965]" />,
        run: () => actions.setChartMode('candles'),
      },
      {
        id: 'view:fit',
        section: 'Chart',
        label: autoFollow ? 'Switch to manual zoom / pan' : 'Auto fit to price',
        keywords: 'zoom fit autofollow follow manual view',
        active: autoFollow,
        icon: <Play size={13} className="text-[#4E5965]" />,
        run: () => (autoFollow ? actions.setAutoFollow(false) : actions.fitView()),
      }
    );

    for (const panel of ['DOM', 'Profile', 'Tape', 'GEX', 'Flow', 'Darkpool', '13F'] as PanelId[]) {
      list.push({
        id: `panel:${panel}`,
        section: 'Panels',
        label: `${activePanel === panel ? 'Hide' : 'Show'} ${panel} panel`,
        hint: `Shortcut: ${(['DOM', 'Profile', 'Tape', 'GEX', 'Flow', 'Darkpool', '13F'] as PanelId[]).indexOf(panel) + 1}`,
        keywords: `panel dock ${panel} workspace`.toLowerCase(),
        active: activePanel === panel,
        icon: <Layers size={13} className="text-[#4E5965]" />,
        run: () => actions.togglePanel(panel),
      });
    }

    const overlayLabels: Record<OverlayKey, string> = {
      vwap: 'VWAP',
      imbalances: 'imbalance highlighting',
      delta: 'delta numbers',
      cvd: 'CVD sub-chart',
    };
    const overlayShortcuts: Record<OverlayKey, string> = { vwap: 'V', imbalances: 'I', delta: 'D', cvd: 'C' };
    for (const key of Object.keys(overlayLabels) as OverlayKey[]) {
      list.push({
        id: `overlay:${key}`,
        section: 'Overlays',
        label: `${overlays[key] ? 'Hide' : 'Show'} ${overlayLabels[key]}`,
        hint: `Shortcut: ${overlayShortcuts[key]}`,
        keywords: `overlay indicator ${overlayLabels[key]}`.toLowerCase(),
        active: overlays[key],
        icon: <Check size={13} className={overlays[key] ? 'text-[#22D3EE]' : 'text-[#4E5965]'} />,
        run: () => actions.toggleOverlay(key),
      });
    }

    list.push(
      {
        id: 'sys:diagnostics',
        section: 'System',
        label: 'Open diagnostics',
        keywords: 'diagnostics status engine health metrics feed',
        icon: <Terminal size={13} className="text-[#4E5965]" />,
        run: actions.openDiagnostics,
      },
      {
        id: 'sys:primer',
        section: 'System',
        label: 'Open order-flow primer',
        keywords: 'help guide primer tutorial onboarding learn',
        icon: <Command size={13} className="text-[#4E5965]" />,
        run: actions.openPrimer,
      }
    );
    if (actions.signOut) {
      list.push({
        id: 'sys:signout',
        section: 'System',
        label: 'Sign out',
        keywords: 'logout signout session account exit',
        icon: <LogOut size={13} className="text-[#4E5965]" />,
        run: actions.signOut,
      });
    }

    return list;
  }, [instruments, currentSymbol, timeframe, chartMode, autoFollow, activePanel, overlays, actions]);

  const normalizedQuery = query.trim().toLowerCase();
  const trimmedUpper = query.trim().toUpperCase();
  const visible = useMemo(() => {
    let result: PaletteEntry[];
    if (!normalizedQuery) {
      result = entries.slice(0, 60);
    } else {
      const terms = normalizedQuery.split(/\s+/);
      result = entries.filter((entry) => terms.every((term) => entry.keywords.includes(term))).slice(0, 60);
    }

    if (trimmedUpper && /^[A-Z0-9.\-_]{1,12}$/.test(trimmedUpper)) {
      const alreadyHasExact = result.some((e) => e.label.toUpperCase() === trimmedUpper);
      if (!alreadyHasExact) {
        result.unshift({
          id: `sym:direct:${trimmedUpper}`,
          section: 'Direct Symbol',
          label: trimmedUpper,
          hint: `Load ${trimmedUpper} directly from Databento API`,
          badge: 'API',
          keywords: trimmedUpper.toLowerCase(),
          icon: <BarChart3 size={13} className="text-[#22D3EE]" />,
          run: () => actions.selectSymbol(trimmedUpper),
        });
      }
    }
    return result;
  }, [entries, normalizedQuery, trimmedUpper, actions]);

  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, PaletteEntry[]>();
    for (const entry of visible) {
      if (!map.has(entry.section)) {
        map.set(entry.section, []);
        order.push(entry.section);
      }
      map.get(entry.section)!.push(entry);
    }
    return order.map((section) => ({ section, items: map.get(section)! }));
  }, [visible]);

  // Clamp on read instead of writing state from an effect: fewer renders and no cascading update.
  const effectiveIndex = Math.min(activeIndex, Math.max(visible.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${effectiveIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [effectiveIndex]);

  if (!isOpen) return null;

  const runEntry = (entry: PaletteEntry | undefined) => {
    if (!entry) {
      if (query.trim()) {
        actions.selectSymbol(query.trim().toUpperCase());
        onClose();
      }
      return;
    }
    entry.run();
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (visible.length === 0 ? 0 : (prev + 1) % visible.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (visible.length === 0 ? 0 : (prev - 1 + visible.length) % visible.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (visible.length > 0 && visible[effectiveIndex]) {
        runEntry(visible[effectiveIndex]);
      } else if (query.trim()) {
        actions.selectSymbol(query.trim().toUpperCase());
        onClose();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  let runningIndex = -1;

  return (
    <div className="dc-overlay" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={onClose}>
      <div className="dc-modal max-w-[640px]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 h-12 border-b border-[#1C2630] bg-[#0D1218]">
          <Search size={14} className="text-[#4E5965] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search instrument, timeframe, panel or action…"
            aria-label="Command palette search"
            className="flex-1 bg-transparent outline-none text-[13px] text-[#E7EDF3] placeholder:text-[#4E5965]"
          />
          <span className="dc-kbd">ESC</span>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {sections.map(({ section, items }) => (
            <div key={section}>
              <div className="dc-section-label">{section}</div>
              {items.map((entry) => {
                runningIndex += 1;
                const index = runningIndex;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    data-index={index}
                    data-active={index === effectiveIndex}
                    className="dc-row"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runEntry(entry)}
                  >
                    <span className="w-4 shrink-0 grid place-items-center">{entry.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-[#E7EDF3] truncate">{entry.label}</span>
                        {entry.badge && (
                          <span className="dc-chip" data-tone="ok">
                            {entry.badge}
                          </span>
                        )}
                        {entry.active && !entry.badge && <Check size={11} className="text-[#22D3EE] shrink-0" />}
                      </span>
                      {entry.hint && <span className="block text-[10px] text-[#7F8B97] truncate">{entry.hint}</span>}
                    </span>
                    <ArrowRight size={12} className="text-[#3A4756] shrink-0" />
                  </button>
                );
              })}
            </div>
          ))}

          {visible.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-[#7F8B97] flex flex-col items-center gap-2.5">
              <div>No command match for “{query}”</div>
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    actions.selectSymbol(query.trim().toUpperCase());
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded bg-[#1C2630] hover:bg-[#25303A] text-[#22D3EE] font-mono text-xs font-semibold border border-[#22D3EE]/30 hover:border-[#22D3EE]/60 transition-colors flex items-center gap-1.5"
                >
                  <span>Load</span>
                  <span className="underline decoration-[#22D3EE]">{query.trim().toUpperCase()}</span>
                  <span>directly from Databento API</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-3 h-9 border-t border-[#1C2630] bg-[#0B0F14] text-[10px] text-[#4E5965] font-mono">
          <span className="flex items-center gap-1.5">
            <Command size={11} /> / or Ctrl+K to open · ↑↓ navigate · ↵ run
          </span>
          <span>
            {instruments.length} instruments · {visible.length} results
          </span>
        </div>
      </div>
    </div>
  );
};
