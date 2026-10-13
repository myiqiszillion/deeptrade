import './offline_guard.cjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const target = process.argv[2];
if (!target) throw new Error('OFFLINE_ISOLATION: bootstrap target required');
await import(pathToFileURL(path.resolve(target)).href);
