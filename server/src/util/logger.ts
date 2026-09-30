/**
 * Console bridge for structured logs.
 *
 * The engines log with console.* throughout; instead of rewriting every call site this bridge
 * upgrades the console itself: with LOG_FORMAT=json every line becomes one JSON object (ts, level,
 * msg) while still containing the original text, so tooling that greps stdout keeps working.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function wantsJson(): boolean {
  return (process.env.LOG_FORMAT || '').toLowerCase() === 'json';
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level: Level, args: unknown[], stream: NodeJS.WriteStream): void {
  const message = args.map(serialize).join(' ');
  if (!wantsJson()) {
    stream.write(message + '\n');
    return;
  }
  stream.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      pid: process.pid,
    }) + '\n'
  );
}

let installed = false;

/** Idempotent: safe to call from the entry point (and from tests) more than once. */
export function installConsoleBridge(): void {
  if (installed) return;
  installed = true;

  console.log = (...args: unknown[]) => emit('info', args, process.stdout);
  console.info = (...args: unknown[]) => emit('info', args, process.stdout);
  console.debug = (...args: unknown[]) => emit('debug', args, process.stdout);
  console.warn = (...args: unknown[]) => emit('warn', args, process.stderr);
  console.error = (...args: unknown[]) => emit('error', args, process.stderr);
}

export function logInfo(message: string, fields?: Record<string, unknown>): void {
  console.log(fields ? `${message} ${JSON.stringify(fields)}` : message);
}

export function logWarn(message: string, fields?: Record<string, unknown>): void {
  console.warn(fields ? `${message} ${JSON.stringify(fields)}` : message);
}

export function logError(message: string, fields?: Record<string, unknown>): void {
  console.error(fields ? `${message} ${JSON.stringify(fields)}` : message);
}
