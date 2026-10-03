/**
 * Databento typed errors — reason strings are safe for FeedStatusEvent.reason
 * (never include the API key or raw vendor body).
 */

export class DatabentoError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class DatabentoAuthError extends DatabentoError {
  constructor(message = 'Databento authentication failed (check DATABENTO_API_KEY)') {
    super(message, 'DATABENTO_AUTH', 401);
  }
}

export class DatabentoRateLimitError extends DatabentoError {
  constructor(
    message = 'Databento rate limit exceeded',
    public readonly retryAfterMs?: number,
  ) {
    super(message, 'DATABENTO_RATE_LIMIT', 429);
  }
}

export class DatabentoDatasetNotFoundError extends DatabentoError {
  constructor(dataset: string) {
    super(`Databento dataset not found: ${dataset}`, 'DATABENTO_DATASET_NOT_FOUND', 404);
  }
}

export class DatabentoCostCapError extends DatabentoError {
  constructor(capUsd: number) {
    super(`Databento cost cap exceeded ($${capUsd})`, 'DATABENTO_COST_CAP', 429);
  }
}

export class DatabentoDecodeError extends DatabentoError {
  constructor(message = 'Failed to decode Databento response') {
    super(message, 'DATABENTO_DECODE_ERROR');
  }
}

export class DatabentoNotConfiguredError extends DatabentoError {
  constructor() {
    super('Databento API key is not configured. Set DATABENTO_API_KEY.', 'VENDOR_NOT_CONFIGURED', 503);
  }
}

export function isDatabentoError(err: unknown): err is DatabentoError {
  return err instanceof DatabentoError;
}

/** Map HTTP status to typed error. */
export function errorForStatus(status: number, bodySnippet: string, dataset?: string): DatabentoError {
  if (status === 401 || status === 403) return new DatabentoAuthError();
  if (status === 429) {
    const retryMs = parseRetryAfter(bodySnippet);
    return new DatabentoRateLimitError(undefined, retryMs);
  }
  if (status === 404 && dataset) return new DatabentoDatasetNotFoundError(dataset);
  return new DatabentoError(`Databento HTTP ${status}: ${bodySnippet.slice(0, 300)}`, 'DATABENTO_HTTP', status);
}

function parseRetryAfter(text: string): number | undefined {
  const m = text.match(/retry[-_ ]after[:\s]+(\d+)/i);
  if (m) {
    const secs = parseInt(m[1], 10);
    if (Number.isFinite(secs)) return secs * 1000;
  }
  return undefined;
}
