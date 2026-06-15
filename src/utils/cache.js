/**
 * Simple in-memory TTL cache for BillTap data calls.
 * DO NOT cache: settlement status, payment status, participant joins,
 * QR token validity, or item claim status — those must always be live.
 */
const cache = new Map();

export const getCached = (key, ttlMs = 60000) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

export const setCached = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
};

export const clearCache = (key) => {
  cache.delete(key);
};