import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthTokenPayload, User } from './types.js';
import { marketDataStore } from '../storage/marketDataStore.js';

export function assertProductionSecretValid(secret?: string): void {
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_JWT_SECRET must be set and at least 32 characters long.');
  }
  if (secret.includes('default') || secret.includes('fallback') || secret.includes('insecure')) {
    throw new Error('Cannot use default or insecure dev secret in production.');
  }
}

function getJwtSecret(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.AUTH_JWT_SECRET;
  if (isProd) {
    assertProductionSecretValid(secret);
    return secret!;
  }
  return secret && secret.length >= 32
    ? secret
    : 'deepchart_default_dev_secret_do_not_use_in_prod_32chars!';
}

// In-memory cache for quick revocation check
const revokedJtis = new Set<string>();

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

function sign(payloadStr: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(payloadStr)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Generate a cryptographically signed JWT token for a user.
 */
export function createToken(user: User, expiresInSec = 86400): string {
  const secret = getJwtSecret();
  const maxExpSec = 30 * 86400; // 30 days max
  const effectiveExpSec = Math.min(Math.max(expiresInSec, 60), maxExpSec);

  const nowSec = Math.floor(Date.now() / 1000);
  const jti = randomBytes(16).toString('hex');

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: AuthTokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: nowSec,
    exp: nowSec + effectiveExpSec,
    jti,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`, secret);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify and decode a JWT token. Returns null if expired, tampered with, malformed, or revoked.
 */
export function verifyToken(token: string): AuthTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const secret = getJwtSecret();

  // Verify signature with timingSafeEqual to prevent timing attacks
  const expectedSig = sign(`${headerB64}.${payloadB64}`, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr) as AuthTokenPayload;

    // Validate payload shape
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.username !== 'string' ||
      (payload.role !== 'user' && payload.role !== 'admin') ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      typeof payload.jti !== 'string'
    ) {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      return null; // Expired
    }

    // Check revocation (both memory cache and persistent store)
    if (revokedJtis.has(payload.jti) || marketDataStore.isTokenJtiRevoked(payload.jti)) {
      return null; // Revoked
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Revoke a token by its JTI (JWT ID).
 */
export function revokeToken(jti: string, userId = 'unknown', expiresAt = Math.floor(Date.now() / 1000) + 86400): void {
  if (jti) {
    revokedJtis.add(jti);
    try {
      marketDataStore.revokeTokenJti(jti, userId, expiresAt);
    } catch {
      // Store may not be initialized in some light unit tests
    }
  }
}

/**
 * Check if a token JTI has been revoked.
 */
export function isTokenRevoked(jti: string): boolean {
  if (!jti) return false;
  return revokedJtis.has(jti) || marketDataStore.isTokenJtiRevoked(jti);
}

/**
 * Clear revocation list (primarily for tests).
 */
export function clearRevocationList(): void {
  revokedJtis.clear();
}
