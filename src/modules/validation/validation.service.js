const { authenticator } = require('otplib');
const eventsService = require('../events/events.service');
const signerService = require('../passes/signer.service');

class ValidationService {
  constructor() {
    // In-memory anti-replay cache for online TOTP scans: key -> expiry timestamp (ms)
    this.replayCache = new Map();

    // Anti-replay cache for offline signed receipt nonces: nonce -> expiry timestamp (ms)
    this.nonceCache = new Map();

    // Default TOTP window: 1 step (±30 seconds)
    authenticator.options = { window: 1 };
  }

  /**
   * Clean expired tokens & nonces from caches
   */
  cleanExpiredTokens() {
    const now = Date.now();
    for (const [key, expiry] of this.replayCache.entries()) {
      if (now > expiry) {
        this.replayCache.delete(key);
      }
    }
    for (const [nonce, expiry] of this.nonceCache.entries()) {
      if (now > expiry) {
        this.nonceCache.delete(nonce);
      }
    }
  }

  /**
   * Online TOTP gate check-in with atomic DB transition & event logging
   */
  verifyAndCheckInTicket({ ticketId, totpToken, actor = 'online_gate' }, ticketRecord) {
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

    // 1. Anti-replay check
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
    const prevStatus = ticketRecord.status;
    ticketRecord.status = 'CHECKED_IN';
    ticketRecord.checkedInAt = new Date().toISOString();

    // 6. Log append-only audit event
    eventsService.logEvent({
      ticketId: ticketRecord.id,
      action: 'CHECKIN',
      actor,
      payload: { ticketId, totpToken },
      statusTransition: `${prevStatus} -> CHECKED_IN`
    });

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

  /**
   * Verifies an offline signed receipt (JWS or EIP-712 format)
   */
  verifyOfflineReceipt(receiptInput) {
    this.cleanExpiredTokens();

    let verifyResult;
    if (typeof receiptInput === 'string' || (receiptInput && receiptInput.format === 'JWS')) {
      const token = typeof receiptInput === 'string' ? receiptInput : receiptInput.token;
      verifyResult = signerService.verifyJWSReceipt(token);
    } else if (receiptInput && (receiptInput.format === 'EIP712' || receiptInput.message)) {
      verifyResult = signerService.verifyEIP712Receipt(receiptInput);
    } else {
      return { status: 400, valid: false, reason: 'Unsupported or missing receipt payload format' };
    }

    if (!verifyResult.valid) {
      return { status: 400, valid: false, reason: verifyResult.reason };
    }

    const { claims } = verifyResult;

    // Nonce replay check
    if (this.nonceCache.has(claims.nonce)) {
      return {
        status: 409,
        valid: false,
        reason: 'Replay attack detected: Receipt nonce has already been scanned'
      };
    }

    // Record nonce in replay cache until receipt expiration
    const expiryMs = claims.expires_at * 1000;
    this.nonceCache.set(claims.nonce, Math.max(expiryMs, Date.now() + 60000));

    return {
      status: 200,
      valid: true,
      claims,
      kid: verifyResult.kid
    };
  }

  /**
   * Processes a batch of offline scan receipts for reconciliation
   */
  reconcileOfflineReceipts(items = [], verifierId = 'verifier_terminal_offline') {
    this.cleanExpiredTokens();

    const results = [];

    for (const item of items) {
      const verifyRes = this.verifyOfflineReceipt(item);

      if (!verifyRes.valid) {
        results.push({
          receiptInput: item,
          status: 'REJECTED_INVALID',
          reason: verifyRes.reason
        });
        continue;
      }

      const { claims } = verifyRes;
      const ticketId = claims.ticket_id;
      const ticketRecord = eventsService.tickets.get(ticketId);

      if (!ticketRecord) {
        results.push({
          ticketId,
          nonce: claims.nonce,
          status: 'REJECTED_NOT_FOUND',
          reason: 'Ticket ID not found in database'
        });
        continue;
      }

      if (ticketRecord.status === 'CHECKED_IN') {
        // Log conflict in audit event log
        eventsService.logEvent({
          ticketId,
          action: 'CHECKIN_CONFLICT',
          actor: verifierId,
          payload: { claims, raw: item },
          statusTransition: 'CHECKED_IN -> CHECKED_IN_CONFLICT'
        });

        results.push({
          ticketId,
          nonce: claims.nonce,
          status: 'REJECTED_CONFLICT',
          reason: 'Ticket was already checked in prior to offline reconciliation'
        });
        continue;
      }

      // Atomically transition status to CHECKED_IN
      const prevStatus = ticketRecord.status;
      ticketRecord.status = 'CHECKED_IN';
      ticketRecord.checkedInAt = new Date().toISOString();

      // Log append-only audit event for offline check-in
      eventsService.logEvent({
        ticketId,
        action: 'CHECKIN_OFFLINE',
        actor: verifierId,
        payload: { claims, raw: item },
        statusTransition: `${prevStatus} -> CHECKED_IN`
      });

      results.push({
        ticketId,
        nonce: claims.nonce,
        status: 'ACCEPTED',
        checkedInAt: ticketRecord.checkedInAt
      });
    }

    return {
      reconciledCount: results.filter(r => r.status === 'ACCEPTED').length,
      rejectedCount: results.filter(r => r.status !== 'ACCEPTED').length,
      results
    };
  }
}

module.exports = new ValidationService();
