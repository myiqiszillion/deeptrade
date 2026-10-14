/**
 * Integration tests exercise the BUILT server (`server/dist/index.js`) and the served client bundle,
 * because that is exactly what a deployment runs. A fresh clone has neither, which used to make
 * `pnpm test` fail with "test server exited early" until someone ran `pnpm build` by hand.
 *
 * This helper keeps that promise: the suites build the artifacts on demand whenever they are
 * missing or older than their sources, so a stale build can never be tested silently.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url)); // server/
const repoRoot = path.resolve(serverRoot, '..'); // repo root
const clientRoot = path.join(repoRoot, 'client');

const SERVER_ENTRY = path.join(serverRoot, 'dist', 'index.js');
const CLIENT_ENTRY = path.join(clientRoot, 'dist', 'index.html');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite', 'data', '.git']);

/** Newest modification time under a directory, ignoring generated/unrelated folders. */
function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs);
  }
  return newest;
}

/** Missing artifact, or one that was built before its sources last changed. */
function isStale(artifact: string, sourceDir: string): boolean {
  if (!existsSync(artifact)) return true;
  return statSync(artifact).mtimeMs < newestMtimeMs(sourceDir);
}

function runBuild(args: string[]): void {
  const isWindows = process.platform === 'win32';
  console.log(`[integration] Building missing/stale artifacts: pnpm ${args.join(' ')}`);
  execFileSync(isWindows ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: isWindows, // .cmd shims require a shell on Windows
  });
}

/** Build the server and/or client bundle when the integration suites need them. */
export function ensureBuiltArtifacts(): void {
  if (isStale(SERVER_ENTRY, path.join(serverRoot, 'src'))) {
    runBuild(['--filter', '@deepchart/server', 'build']);
  }
  if (isStale(CLIENT_ENTRY, clientRoot)) {
    runBuild(['--filter', 'client', 'build']);
  }
}
