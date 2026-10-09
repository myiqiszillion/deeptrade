/**
 * Symbol preferences shared by the picker and the command palette.
 *
 * Kept in its own module so neither component has to import the other (that would be a circular import:
 * the palette renders picker rows, the picker wants the palette's favourites helpers).
 *
 * All access is wrapped: localStorage can be disabled by the browser or by policy, and recents/favourites
 * are a convenience — never a requirement for the terminal to work.
 */
const RECENTS_KEY = 'deepchart_recent_symbols_v1';
const FAVORITES_KEY = 'deepchart_favorite_symbols_v1';
const MAX_RECENTS = 8;

function readList(key: string, limit = Number.MAX_SAFE_INTEGER): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string').slice(0, limit);
  } catch {
    return [];
  }
}

function writeList(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* storage unavailable: ignore */
  }
}

export function loadRecentSymbols(): string[] {
  return readList(RECENTS_KEY, MAX_RECENTS);
}

export function rememberSymbol(symbol: string): void {
  if (!symbol) return;
  writeList(RECENTS_KEY, [symbol, ...loadRecentSymbols().filter((value) => value !== symbol)].slice(0, MAX_RECENTS));
}

export function loadFavoriteSymbols(): string[] {
  return readList(FAVORITES_KEY);
}

/** Toggle a symbol in the favourites list and return the new list. */
export function toggleFavoriteSymbol(symbol: string): string[] {
  const current = loadFavoriteSymbols();
  const next = current.includes(symbol) ? current.filter((value) => value !== symbol) : [...current, symbol];
  writeList(FAVORITES_KEY, next);
  return next;
}
