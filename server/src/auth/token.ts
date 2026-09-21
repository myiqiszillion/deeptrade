import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthTokenPayload, User } from './types.js';

const DEFAULT_SECRET = 'deepchart_default_dev_secret_do_not_use_in_prod_32chars!';
const JWT_SECRET = process.env.AUTH_JWT_SECRET || DEFAULT_SECRET;

// In-memory revocation set for revoked token JTIs
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
  const nowSec = Math.floor(Date.now() / 1000);
  const jti = randomBytes(16).toString('hex');

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: AuthTokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: nowSec,
    exp: nowSec + expiresInSec,
    jti,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`, JWT_SECRET);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify and decode a JWT token. Returns null if expired, tampered with, or revoked.
 */
export function verifyToken(token: string): AuthTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;

  // Verify signature with timingSafeEqual to prevent timing attacks
  const expectedSig = sign(`${headerB64}.${payloadB64}`, JWT_SECRET);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr) as AuthTokenPayload;

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return null; // Expired
    }

    if (payload.jti && revokedJtis.has(payload.jti)) {
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
export function revokeToken(jti: string): void {
  if (jti) {
    revokedJtis.add(jti);
  }
}

/**
 * Check if a token JTI has been revoked.
 */
export function isTokenRevoked(jti: string): boolean {
  return revokedJtis.has(jti);
}

/**
 * Clear revocation list (primarily for tests).
 */
export function clearRevocationList(): void {
  revokedJtis.clear();
}
