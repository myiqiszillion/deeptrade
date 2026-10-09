/**
 * Binary Codec for MBP-10 Market Depth Snapshots
 *
 * Encodes top-N bid and ask levels into a compact binary buffer for SQLite BLOB storage.
 * Schema v1 layout:
 * - 1 byte:  uint8 bidCount (N <= 255)
 * - N * 16 bytes: each level has [price: float64 LE (8B), size: float64 LE (8B)]
 * - 1 byte:  uint8 askCount (M <= 255)
 * - M * 16 bytes: each level has [price: float64 LE (8B), size: float64 LE (8B)]
 *
 * Total size for MBP-10 (10 bids + 10 asks): 1 + 160 + 1 + 160 = 322 bytes.
 * Zero-Mock, zero string parsing, high-throughput binary serialization.
 */

export interface DepthLevelEntry {
  price: number;
  size: number;
}

export interface DecodedDepthLevels {
  bids: DepthLevelEntry[];
  asks: DepthLevelEntry[];
}

export function encodeDepthLevels(
  bids: ([number, number] | DepthLevelEntry)[] = [],
  asks: ([number, number] | DepthLevelEntry)[] = []
): Buffer {
  const safeBids: DepthLevelEntry[] = bids
    .map((b) => (Array.isArray(b) ? { price: b[0], size: b[1] } : b))
    .filter((b) => Number.isFinite(b.price) && Number.isFinite(b.size) && b.size > 0)
    .slice(0, 50);

  const safeAsks: DepthLevelEntry[] = asks
    .map((a) => (Array.isArray(a) ? { price: a[0], size: a[1] } : a))
    .filter((a) => Number.isFinite(a.price) && Number.isFinite(a.size) && a.size > 0)
    .slice(0, 50);

  const totalLength = 1 + safeBids.length * 16 + 1 + safeAsks.length * 16;
  const buf = Buffer.allocUnsafe(totalLength);
  let offset = 0;

  // Bids count
  buf.writeUInt8(safeBids.length, offset);
  offset += 1;

  for (let i = 0; i < safeBids.length; i++) {
    buf.writeDoubleLE(safeBids[i].price, offset);
    offset += 8;
    buf.writeDoubleLE(safeBids[i].size, offset);
    offset += 8;
  }

  // Asks count
  buf.writeUInt8(safeAsks.length, offset);
  offset += 1;

  for (let i = 0; i < safeAsks.length; i++) {
    buf.writeDoubleLE(safeAsks[i].price, offset);
    offset += 8;
    buf.writeDoubleLE(safeAsks[i].size, offset);
    offset += 8;
  }

  return buf;
}

export function decodeDepthLevels(data: Buffer | Uint8Array | null | undefined): DecodedDepthLevels {
  if (!data || data.length === 0) {
    return { bids: [], asks: [] };
  }

  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // If data was stored as legacy JSON string
  if (buf[0] === 0x7b /* '{' */ || buf[0] === 0x5b /* '[' */) {
    try {
      const parsed = JSON.parse(buf.toString('utf8'));
      if (parsed && typeof parsed === 'object') {
        const bids = Array.isArray(parsed.bids) ? parsed.bids : [];
        const asks = Array.isArray(parsed.asks) ? parsed.asks : [];
        return { bids, asks };
      }
    } catch {
      return { bids: [], asks: [] };
    }
  }

  try {
    let offset = 0;
    if (buf.length < 1) return { bids: [], asks: [] };

    const bidsCount = buf.readUInt8(offset);
    offset += 1;

    const expectedBidsBytes = bidsCount * 16;
    if (offset + expectedBidsBytes > buf.length) {
      return { bids: [], asks: [] };
    }

    const bids: DepthLevelEntry[] = new Array(bidsCount);
    for (let i = 0; i < bidsCount; i++) {
      const price = buf.readDoubleLE(offset);
      offset += 8;
      const size = buf.readDoubleLE(offset);
      offset += 8;
      bids[i] = { price, size };
    }

    if (offset >= buf.length) {
      return { bids, asks: [] };
    }

    const asksCount = buf.readUInt8(offset);
    offset += 1;

    const expectedAsksBytes = asksCount * 16;
    if (offset + expectedAsksBytes > buf.length) {
      return { bids, asks: [] };
    }

    const asks: DepthLevelEntry[] = new Array(asksCount);
    for (let i = 0; i < asksCount; i++) {
      const price = buf.readDoubleLE(offset);
      offset += 8;
      const size = buf.readDoubleLE(offset);
      offset += 8;
      asks[i] = { price, size };
    }

    return { bids, asks };
  } catch {
    return { bids: [], asks: [] };
  }
}

export function encodeDepthBinary(
  bids: ([number, number] | DepthLevelEntry)[] = [],
  asks: ([number, number] | DepthLevelEntry)[] = []
): Buffer {
  const normBids: DepthLevelEntry[] = bids.map((b) => (Array.isArray(b) ? { price: b[0], size: b[1] } : b));
  const normAsks: DepthLevelEntry[] = asks.map((a) => (Array.isArray(a) ? { price: a[0], size: a[1] } : a));
  return encodeDepthLevels(normBids, normAsks);
}

export function decodeDepthBinary(
  data: Buffer | Uint8Array | null | undefined
): { bids: [number, number][]; asks: [number, number][] } {
  const decoded = decodeDepthLevels(data);
  return {
    bids: decoded.bids.map((b) => [b.price, b.size]),
    asks: decoded.asks.map((a) => [a.price, a.size]),
  };
}

