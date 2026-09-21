export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
}

export interface AuthTokenPayload {
  sub: string; // userId
  username: string;
  role: UserRole;
  exp: number; // Epoch seconds
  iat: number; // Epoch seconds
  jti: string; // Unique token ID for revocation
}

export type DataType = 'BARS' | 'TICKS' | 'FOOTPRINT' | 'L2_BOOK' | 'MBO' | 'REPLAY' | '*';

export interface Entitlement {
  id: string;
  userId: string;
  provider: string; // 'binance' | 'cme' | 'cbot' | 'comex' | 'nymex' | 'tradovate' | 'databento' | '*'
  exchange?: string; // 'CME' | 'NYMEX' | 'COMEX' | 'CBOT' | 'BINANCE' | '*'
  symbolPattern?: string; // e.g. 'ES*', 'BTCUSDT', '*'
  dataTypes: DataType[];
  validUntil: number; // Epoch milliseconds
  createdAt: number;
}
