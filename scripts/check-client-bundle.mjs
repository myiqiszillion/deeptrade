#!/usr/bin/env node
/**
 * Client bundle smoke test.
 *
 * The UI shell has no browser test runner, so this is the cheap automated guard that the *built* client
 * actually contains the product surfaces we shipped: the command palette, favourites, the design-system
 * primitives and the empty-state actions. It catches "the file was edited but never made it into the
 * bundle" (dead module, build skipped, stale dist) without needing a headless browser.
 *
 * Skips (exit 0) when client/dist is missing so a source-only test run stays green.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'client/dist');
const indexPath = resolve(distDir, 'index.html');

if (!existsSync(indexPath)) {
  console.log('[client-check] client/dist not built — skipping bundle smoke test (run `pnpm build` first)');
  process.exit(0);
}

const html = readFileSync(indexPath, 'utf8');
const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
const jsAssets = assetPaths.filter((path) => path.endsWith('.js'));
const cssAssets = assetPaths.filter((path) => path.endsWith('.css'));

// Lazy-loaded chunks are not referenced by index.html, but they are part of the shipped product: scan every
// JS/CSS file in dist/assets for product markers, and use the index.html set only for entry-size checks.
const assetsDir = resolve(distDir, 'assets');
const allAssetFiles = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
const allJsAssets = allAssetFiles.filter((name) => name.endsWith('.js')).map((name) => `assets/${name}`);
const allCssAssets = allAssetFiles.filter((name) => name.endsWith('.css')).map((name) => `assets/${name}`);

const failures = [];
const resolveAsset = (assetPath) => resolve(distDir, String(assetPath).replace(/^\//, ''));
const read = (assetPath) => {
  const file = resolveAsset(assetPath);
  if (!existsSync(file)) {
    failures.push(`asset referenced by index.html is missing: ${assetPath}`);
    return '';
  }
  const size = statSync(file).size;
  if (size < 512) failures.push(`asset looks empty (${size} bytes): ${assetPath}`);
  return readFileSync(file, 'utf8');
};

if (jsAssets.length === 0) failures.push('index.html references no JS bundle');
if (cssAssets.length === 0) failures.push('index.html references no CSS bundle');

const js = allJsAssets.length > 0 ? allJsAssets.map(read).join('\n') : jsAssets.map(read).join('\n');
const css = allCssAssets.length > 0 ? allCssAssets.map(read).join('\n') : cssAssets.map(read).join('\n');
if (allJsAssets.length === 0) failures.push('no JS chunks found in dist/assets');

/** Markers that must survive minification (plain string literals in the source). */
const JS_MARKERS = [
  ['command palette', 'CommandPalette component'],
  ['chart legend', 'TradingView-style chart legend'],
  ['chart tools', 'left tool rail'],
  ['watchlist', 'watchlist panel'],
  ['filter watchlist', 'watchlist filter input'],
  ['enable_quote_board', 'quote-board opt-in hint'],
  ['mã khác: giá vendor', 'watchlist quote provenance'],
  ['deepchart_recent_symbols_v1', 'recent-symbols persistence'],
  ['deepchart_favorite_symbols_v1', 'favourite-symbols persistence'],
  ['favourites', 'Favourites picker tab'],
  ['open diagnostics', 'actionable empty state'],
  ['deepchart_dock_width_v1', 'dock width persistence'],
  ['deepchart_jwt_token', 'token storage key'],
  ['shortcut: f', 'keyboard shortcut hints'],
  ['[1-5]', 'shortcut cheat sheet'],
  ['deepchart_layout_v1', 'dock-side layout persistence'],
  ['resize analytics dock', 'dock divider (a11y label)'],
  ['resize cvd panel', 'CVD divider (a11y label)'],
  ['no vendor', 'honest idle/no-vendor feed badges'],
  ['chưa subscribe', 'picker badge legend'],
];

const CSS_MARKERS = [
  ['.dc-chip', 'chip primitive'],
  ['.dc-overlay', 'overlay primitive'],
  ['.terminal-btn', 'button primitive'],
  ['--accent', 'design tokens'],
  ['prefers-reduced-motion', 'reduced-motion support'],
  ['.tv-toolrail', 'tool-rail skin'],
  ['.tv-legend-chip', 'legend chip skin'],
  ['.tv-watchlist', 'watchlist skin'],
  ['#131722', 'TradingView-style surfaces'],
];

const lowerJs = js.toLowerCase();
for (const [needle, label] of JS_MARKERS) {
  if (!lowerJs.includes(needle.toLowerCase())) failures.push(`JS bundle is missing ${label} ("${needle}")`);
}
for (const [needle, label] of CSS_MARKERS) {
  if (!css.includes(needle)) failures.push(`CSS bundle is missing ${label} ("${needle}")`);
}

// Code-splitting guard: the entry chunk must stay small, and lazy panels must exist as separate chunks.
const chunkSizes = allJsAssets.map((assetPath) => {
  const file = resolveAsset(assetPath);
  return { assetPath, bytes: existsSync(file) ? statSync(file).size : 0 };
});
const MAX_ENTRY_BYTES = 480 * 1024;
const entryChunk = jsAssets
  .map((assetPath) => resolveAsset(assetPath))
  .map((file) => (existsSync(file) ? statSync(file).size : 0))
  .map((bytes, index) => ({ assetPath: jsAssets[index], bytes }))
  .find((chunk) => chunk.bytes > 0);
if (entryChunk && entryChunk.bytes > MAX_ENTRY_BYTES) {
  failures.push(
    `entry chunk is ${Math.round(entryChunk.bytes / 1024)} KB (limit ${Math.round(MAX_ENTRY_BYTES / 1024)} KB) — add manualChunks/lazy imports`
  );
}
if (chunkSizes.length < 4) {
  failures.push(`expected code-split output (>=4 JS chunks incl. lazy panels), found ${chunkSizes.length}`);
}

if (failures.length > 0) {
  console.error('[client-check] FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const kb = (bytes) => Math.round(bytes / 1024);
const biggest = [...chunkSizes].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
console.log(
  `[client-check] OK: ${chunkSizes.length} JS chunk(s) (entry ${kb(entryChunk?.bytes ?? 0)} KB), ` +
    `${allCssAssets.length} CSS (~${kb(css.length)} KB), ${JS_MARKERS.length + CSS_MARKERS.length} product markers present`
);
console.log(
  `[client-check] largest chunks: ${biggest.map((chunk) => `${chunk.assetPath.split('/').pop()} ${kb(chunk.bytes)} KB`).join(', ')}`
);
