const { config } = require('../config');

class RateLimiter {
  constructor() {
    // Sliding window records: key -> array of timestamps in ms
    this.windows = new Map();
  }

  cleanExpired(windowMs = 60000) {
    const now = Date.now();
    for (const [key, timestamps] of this.windows.entries()) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }

  recordRequest(key) {
    const now = Date.now();
    const timestamps = this.windows.get(key) || [];
    timestamps.push(now);
    this.windows.set(key, timestamps);
  }

  getRecentCount(key, windowMs = 60000) {
    this.cleanExpired(windowMs);
    const now = Date.now();
    const timestamps = this.windows.get(key) || [];
    return timestamps.filter(t => now - t < windowMs).length;
  }

  checkAndRecordGeneral(ip, limit = config.rateLimitPassRequestsPerMin || 60, windowMs = 60000) {
    const key = `gen:${ip}`;
    const count = this.getRecentCount(key, windowMs);
    if (count >= limit) {
      return { limited: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
    this.recordRequest(key);
    return { limited: false };
  }

  checkFailureLimit(key, limit = config.rateLimitPassFailsPerMin || 10, windowMs = 60000) {
    const count = this.getRecentCount(key, windowMs);
    if (count >= limit) {
      return { limited: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
    return { limited: false };
  }

  recordFailure(key) {
    this.recordRequest(key);
  }

  reset() {
    this.windows.clear();
  }
}

module.exports = new RateLimiter();
