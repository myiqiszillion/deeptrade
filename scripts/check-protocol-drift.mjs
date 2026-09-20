#!/usr/bin/env node
/**
 * Guards the WebSocket protocol against silent drift.
 *
 * The protocol types are intentionally duplicated in `server/src/types.ts` and
 * `client/src/types/index.ts` (splitting them into a shared workspace package would require
 * an extra ESM build step in the NodeNext server pipeline). This script extracts every
 * message `type` literal declared on both sides and fails when one side knows a message
 * that the other does not, which is the failure mode that actually breaks the app.
 *
 * Usage: pnpm verify:types
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  server: path.join(root, 'server', 'src', 'types.ts'),
  client: path.join(root, 'client', 'src', 'types', 'index.ts'),
};

const UNIONS = {
  clientToServer: 'WSClientMessage',
  serverToClient: 'WSServerMessage',
};

/** Slice out a `export type X = ...` union up to the next top-level export. */
function extractUnion(source, name) {
  const start = source.indexOf(`export type ${name} =`);
  if (start === -1) throw new Error(`Could not find "export type ${name} ="`);
  const tail = source.slice(start);
  const nextExport = tail.indexOf('\nexport ', 1);
  return nextExport === -1 ? tail : tail.slice(0, nextExport);
}

/** Collect every `type: 'NAME'` literal inside a union body. */
function extractMessageTypes(unionBody) {
  const found = new Set();
  const re = /type:\s*'([A-Z][A-Z0-9_]*)'/g;
  let match;
  while ((match = re.exec(unionBody)) !== null) found.add(match[1]);
  return found;
}

const parsed = {};
for (const [side, file] of Object.entries(FILES)) {
  const source = readFileSync(file, 'utf8');
  parsed[side] = {};
  for (const [direction, unionName] of Object.entries(UNIONS)) {
    parsed[side][direction] = extractMessageTypes(extractUnion(source, unionName));
  }
}

const problems = [];
for (const [direction, unionName] of Object.entries(UNIONS)) {
  const label = direction === 'clientToServer' ? 'client -> server' : 'server -> client';
  const serverTypes = parsed.server[direction];
  const clientTypes = parsed.client[direction];

  if (serverTypes.size === 0) problems.push(`${label}: no messages parsed from ${unionName} on the server side`);
  if (clientTypes.size === 0) problems.push(`${label}: no messages parsed from ${unionName} on the client side`);

  for (const name of serverTypes) {
    if (!clientTypes.has(name)) problems.push(`${label}: server declares '${name}' but the client does not`);
  }
  for (const name of clientTypes) {
    if (!serverTypes.has(name)) problems.push(`${label}: client declares '${name}' but the server does not`);
  }
}

console.log('Protocol coverage:');
for (const [direction, unionName] of Object.entries(UNIONS)) {
  console.log(
    `  ${unionName.padEnd(15)} server=${parsed.server[direction].size} client=${parsed.client[direction].size}`
  );
}

if (problems.length > 0) {
  console.error('\nProtocol drift detected:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('\nNo protocol drift between server and client type declarations.');
