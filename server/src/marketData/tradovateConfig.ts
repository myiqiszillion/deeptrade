import { TradovateCredentials, TradovateEnv } from './tradovateTransport.js';

/**
 * Tradovate provider configuration, read from the environment.
 *
 * Credentials are server-side only and are NEVER logged, serialized into a status reason or
 * sent to the browser. `credentialFreeMessage` is the last line of defence: every string that
 * reaches `FeedStatusEvent.reason` is passed through it.
 */
export interface TradovateConfig {
  /** 'demo' streams against demo.tradovateapi.com, 'live' against live.tradovateapi.com. */
  env: TradovateEnv;
  /** null when any required field is missing — the adapter then reports UNAVAILABLE. */
  credentials: TradovateCredentials | null;
  /** Human-readable reason why credentials are null. */
  missingReason?: string;
  /** Explicit contract month (e.g. `ESZ6`). Empty = use the continuous `@SYMBOL` form. */
  symbolOverride?: string;
  /** Subscribe the micro contract (MES/MNQ/...) instead of the full-size one. */
  useMicro: boolean;
}

const REQUIRED_ENV_FIELDS: ReadonlyArray<{ env: string; field: keyof TradovateCredentials }> = [
  { env: 'TRADOVATE_USERNAME', field: 'name' },
  { env: 'TRADOVATE_PASSWORD', field: 'password' },
  { env: 'TRADOVATE_APP_ID', field: 'appId' },
  { env: 'TRADOVATE_APP_VERSION', field: 'appVersion' },
  { env: 'TRADOVATE_CID', field: 'cid' },
  { env: 'TRADOVATE_SEC', field: 'sec' },
];

/**
 * Tokens that must never appear in a user-visible reason. The values are matched
 * case-insensitively and replaced with a fixed placeholder.
 */
const SENSITIVE_ENV_VARS = [
  'TRADOVATE_PASSWORD',
  'TRADOVATE_SEC',
  'TRADOVATE_CID',
  'TRADOVATE_APP_ID',
  'TRADOVATE_USERNAME',
] as const;

/**
 * Scrub a vendor/transport message so it cannot carry a secret. Tradovate's `errorText` is
 * vendor-supplied (e.g. "Incorrect username or password") and already safe, but tokens and
 * URLs are echoed by fetch failures, so this is applied defensively everywhere.
 */
export function credentialFreeMessage(message: string): string {
  let scrubbed = message;
  for (const name of SENSITIVE_ENV_VARS) {
    const value = process.env[name];
    if (!value || value.length < 3) continue;
    scrubbed = scrubbed.split(value).join('[redacted]');
  }
  // A bearer token can leak through a transport error string.
  scrubbed = scrubbed.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
  return scrubbed;
}

/** Parse `TRADOVATE_ENV`, defaulting to the demo cluster (never silently points at live). */
export function parseTradovateEnv(raw: string | undefined): TradovateEnv {
  return raw?.trim().toLowerCase() === 'live' ? 'live' : 'demo';
}

/** Read + validate the provider config. Missing credentials yield a descriptive reason. */
export function readTradovateConfig(env: NodeJS.ProcessEnv = process.env): TradovateConfig {
  const parsedEnv = parseTradovateEnv(env.TRADOVATE_ENV);
  const symbolOverride = env.TRADOVATE_SYMBOL?.trim();
  const useMicro = ['1', 'true', 'yes'].includes((env.TRADOVATE_USE_MICRO || '').trim().toLowerCase());

  const missing: string[] = [];
  const values: Record<string, string> = {};
  for (const { env: name, field } of REQUIRED_ENV_FIELDS) {
    const raw = env[name]?.trim();
    if (!raw) missing.push(name);
    else values[field as string] = raw;
  }

  if (missing.length > 0) {
    return {
      env: parsedEnv,
      credentials: null,
      missingReason: `TRADOVATE_PROVIDER incomplete: missing ${missing.join(', ')}`,
      symbolOverride,
      useMicro,
    };
  }

  const cid = Number(values.cid);
  if (!Number.isFinite(cid)) {
    return {
      env: parsedEnv,
      credentials: null,
      missingReason: 'TRADOVATE_CID must be a numeric client/application id',
      symbolOverride,
      useMicro,
    };
  }

  return {
    env: parsedEnv,
    credentials: {
      name: values.name,
      password: values.password,
      appId: values.appId,
      appVersion: values.appVersion,
      cid,
      sec: values.sec,
    },
    symbolOverride,
    useMicro,
  };
}
