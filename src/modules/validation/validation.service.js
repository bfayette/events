const { authenticator } = require('otplib');

class ValidationService {
  constructor() {
    // In-memory anti-replay cache: key -> token, value -> expiry timestamp (ms)
    this.replayCache = new Map();

    // Default TOTP window: 1 step (±30 seconds)
    authenticator.options = { window: 1 };
  }

  /**
   * Clean expired tokens from cache
   */
  cleanExpiredTokens() {
    const now = Date.now();
    for (const [key, expiry] of this.replayCache.entries()) {
      if (now > expiry) {
        this.replayCache.delete(key);
      }
    }
  }

  /**
   * Verifies scanned pass token `{ ticketId, totpToken }` against ticket secret and anti-replay cache.
   */
  verifyAndCheckInTicket({ ticketId, totpToken }, ticketRecord) {
    this.cleanExpiredTokens();

    if (!ticketRecord) {
      return {
        status: 400,
        result: { message: 'Invalid scan: Ticket record not found' }
      };
    }

    if (!totpToken) {
      return {
        status: 400,
        result: { message: 'Invalid scan: totpToken missing' }
      };
    }

    // 1. Anti-replay check (must take precedence e.g. for duplicate scanned token attempts)
    const cacheKey = `${ticketId}:${totpToken}`;
    if (this.replayCache.has(cacheKey)) {
      return {
        status: 409,
        result: { message: 'Replay attack detected: Token has already been scanned' }
      };
    }

    // 2. Already checked-in check
    if (ticketRecord.status === 'CHECKED_IN') {
      return {
        status: 400,
        result: { message: 'Ticket has already been checked in previously' }
      };
    }

    // 3. Validate TOTP
    const isValid = authenticator.check(totpToken, ticketRecord.secret);
    if (!isValid) {
      return {
        status: 400,
        result: { message: 'Invalid or expired TOTP token' }
      };
    }

    // 4. Store in replay cache with TTL (60 seconds)
    const ttlMs = 60 * 1000;
    this.replayCache.set(cacheKey, Date.now() + ttlMs);

    // 5. Atomically transition status to CHECKED_IN
    ticketRecord.status = 'CHECKED_IN';
    ticketRecord.checkedInAt = new Date().toISOString();

    return {
      status: 200,
      result: {
        message: 'Gate check-in successful',
        ticketId: ticketRecord.id,
        status: ticketRecord.status,
        checkedInAt: ticketRecord.checkedInAt
      }
    };
  }
}

module.exports = new ValidationService();
