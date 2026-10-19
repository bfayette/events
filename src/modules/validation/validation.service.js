const { authenticator } = require('otplib');
const eventsService = require('../events/events.service');
const signerService = require('../passes/signer.service');

const { hashShortCode } = require('../passes/shortcode.service');
const { config } = require('../../config');
const { consumeLookupToken } = require('./lookup.service');

class ValidationService {
  constructor() {
    // In-memory anti-replay cache for online TOTP scans: key -> expiry timestamp (ms)
    this.replayCache = new Map();

    // Anti-replay cache for offline signed receipt nonces: nonce -> expiry timestamp (ms)
    this.nonceCache = new Map();

    // Sliding window failure logs: key -> array of timestamps in ms
    this.failureWindows = new Map();

    // Default TOTP window: 1 step (±30 seconds)
    authenticator.options = { window: 1 };
  }

  /**
   * Cleans expired rate limit failure logs
   */
  cleanExpiredFailures() {
    const now = Date.now();
    const windowMs = 60000;
    for (const [key, timestamps] of this.failureWindows.entries()) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        this.failureWindows.delete(key);
      } else {
        this.failureWindows.set(key, valid);
      }
    }
  }

  /**
   * Checks rate limit for short-code / lookup failures
   */
  checkRateLimit({ verifierLabel, eventId }) {
    this.cleanExpiredFailures();
    const now = Date.now();
    const windowMs = 60000;

    const verifierKey = `verifier:${verifierLabel}`;
    const eventKey = `event:${eventId}`;

    const verifierFails = (this.failureWindows.get(verifierKey) || []).filter(t => now - t < windowMs).length;
    const eventFails = (this.failureWindows.get(eventKey) || []).filter(t => now - t < windowMs).length;

    const maxVerifier = config.rateLimitVerifierFailsPerMin || 5;
    const maxEvent = config.rateLimitEventFailsPerMin || 30;

    if (verifierFails >= maxVerifier || eventFails >= maxEvent) {
      return { limited: true, reason: verifierFails >= maxVerifier ? 'verifier_limit' : 'event_limit' };
    }
    return { limited: false };
  }

  /**
   * Records a failed attempt for rate limiting
   */
  recordFailure({ verifierLabel, eventId }) {
    const now = Date.now();
    if (verifierLabel) {
      const vKey = `verifier:${verifierLabel}`;
      const vList = this.failureWindows.get(vKey) || [];
      vList.push(now);
      this.failureWindows.set(vKey, vList);
    }
    if (eventId) {
      const eKey = `event:${eventId}`;
      const eList = this.failureWindows.get(eKey) || [];
      eList.push(now);
      this.failureWindows.set(eKey, eList);
    }
  }

  /**
   * Shared entry consumption logic for TOTP, STATIC_QR, SHORT_CODE, and LOOKUP
   */
  consumeEntry({ method = 'TOTP', ticket, verifierLabel = 'dev', eventId = null, staticClaims = null }) {
    /*
     * SQL equivalent for atomic DB entry consumption:
     * UPDATE tickets
     * SET entries_used = entries_used + 1,
     *     status = CASE WHEN entries_used + 1 = max_entries THEN 'CHECKED_IN'::ticket_status ELSE status END,
     *     checked_in_at = CASE WHEN entries_used + 1 = max_entries THEN CURRENT_TIMESTAMP ELSE checked_in_at END,
     *     updated_at = CURRENT_TIMESTAMP
     * WHERE id = $1 AND version = $2 AND status != 'REVOKED' AND entries_used < max_entries
     * RETURNING *;
     */

    const nowIso = new Date().toISOString();

    if (!ticket) {
      eventsService.logEvent({
        ticketId: staticClaims?.ticket_id || 'unknown',
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method, eventId },
        method,
        result: 'DENIED_INVALID'
      });
      return {
        status: 400,
        result: { message: 'Invalid scan: Ticket not found', code: 'DENIED_INVALID' }
      };
    }

    const tkt = eventsService.getTicketWithDefaults(ticket);

    // 1. Status check: REVOKED
    if (tkt.status === 'REVOKED') {
      eventsService.logEvent({
        ticketId: tkt.id,
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method, eventId },
        method,
        result: 'DENIED_REVOKED'
      });
      return {
        status: 400,
        result: { message: 'Scan denied: Ticket has been revoked', code: 'DENIED_REVOKED' }
      };
    }

    // 2. Version check (for static codes)
    if (staticClaims && staticClaims.v !== undefined && staticClaims.v !== tkt.version) {
      eventsService.logEvent({
        ticketId: tkt.id,
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method, tokenVersion: staticClaims.v, currentVersion: tkt.version },
        method,
        result: 'DENIED_SUPERSEDED'
      });
      return {
        status: 400,
        result: { message: 'Scan denied: Ticket has been reissued and code is superseded', code: 'DENIED_SUPERSEDED' }
      };
    }

    // 3. Multi-entry check: entries_used < max_entries
    if (tkt.entries_used >= tkt.max_entries) {
      const prevEvents = eventsService.getEventsForTicket(tkt.id).filter(e => e.action === 'CHECKIN');
      const lastCheckin = prevEvents[prevEvents.length - 1];

      const previousEntry = lastCheckin
        ? {
            timestamp: lastCheckin.createdAt,
            method: lastCheckin.method || 'TOTP',
            verifierLabel: lastCheckin.actor
          }
        : {
            timestamp: tkt.checkedInAt || nowIso,
            method: tkt.code_mode || 'TOTP',
            verifierLabel: 'unknown'
          };

      eventsService.logEvent({
        ticketId: tkt.id,
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method, entriesUsed: tkt.entries_used, maxEntries: tkt.max_entries },
        method,
        result: 'DENIED_ALREADY_USED',
        meta: { previousEntry }
      });

      return {
        status: 400,
        result: {
          message: 'Scan denied: All entries for this ticket have already been used',
          code: 'DENIED_ALREADY_USED',
          previousEntry
        }
      };
    }

    // 4. Consume entry
    const prevStatus = tkt.status;
    const prevEntries = ticket.entries_used || 0;
    ticket.entries_used = prevEntries + 1;

    let newStatus = prevStatus;
    if (ticket.entries_used === tkt.max_entries) {
      newStatus = 'CHECKED_IN';
      ticket.status = 'CHECKED_IN';
      ticket.checkedInAt = nowIso;
    }

    const transitionText = `${prevStatus} (${ticket.entries_used}/${tkt.max_entries})`;

    eventsService.logEvent({
      ticketId: tkt.id,
      action: 'CHECKIN',
      actor: verifierLabel,
      payload: { method, entriesUsed: ticket.entries_used, maxEntries: tkt.max_entries },
      statusTransition: transitionText,
      method,
      result: 'ACCEPTED'
    });

    return {
      status: 200,
      result: {
        message: method === 'TOTP' ? 'Gate check-in successful' : 'Entry check-in successful',
          ticketId: tkt.public_ref || tkt.id,
        status: ticket.status,
        entriesUsed: ticket.entries_used,
        maxEntries: tkt.max_entries,
        checkedInAt: ticket.checkedInAt || nowIso
      }
    };
  }

  /**
   * Handles STATIC_QR scan verification
   */
  verifyStaticQrScan({ payload, eventId, verifierLabel, actor }) {
    if (!payload) {
      return {
        status: 400,
        result: { message: 'STATIC_QR payload is required', code: 'DENIED_INVALID' }
      };
    }

    const verifyRes = signerService.verifyStaticCode(payload);
    if (!verifyRes.valid) {
      eventsService.logEvent({
        ticketId: 'unknown',
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method: 'STATIC_QR', reason: verifyRes.reason },
        method: 'STATIC_QR',
        result: 'DENIED_INVALID'
      });
      return {
        status: 400,
        result: { message: `Scan denied: ${verifyRes.reason}`, code: 'DENIED_INVALID' }
      };
    }

    const { claims } = verifyRes;

    const { checkEventScope } = require('../auth/auth.middleware');
    if (actor && !checkEventScope(actor, claims.event_id)) {
      return {
        status: 403,
        result: { message: `Forbidden: Access denied for event ${claims.event_id}` }
      };
    }

    if (eventId && claims.event_id !== eventId) {
      eventsService.logEvent({
        ticketId: claims.ticket_id,
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method: 'STATIC_QR', tokenEventId: claims.event_id, verifierEventId: eventId },
        method: 'STATIC_QR',
        result: 'DENIED_WRONG_EVENT'
      });
      return {
        status: 400,
        result: { message: 'Scan denied: Event ID mismatch', code: 'DENIED_WRONG_EVENT' }
      };
    }

    const ticket = eventsService.getTicketByIdOrPublicRef(claims.ticket_id);
    return this.consumeEntry({
      method: 'STATIC_QR',
      ticket,
      verifierLabel,
      eventId: claims.event_id,
      staticClaims: claims
    });
  }

  /**
   * Handles SHORT_CODE scan verification
   */
  verifyShortCodeScan({ code, eventId, verifierLabel }) {
    if (!code || !eventId) {
      return {
        status: 400,
        result: { message: 'Short code and eventId are required', code: 'DENIED_INVALID' }
      };
    }

    const rateCheck = this.checkRateLimit({ verifierLabel, eventId });
    if (rateCheck.limited) {
      eventsService.logEvent({
        ticketId: 'unknown',
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method: 'SHORT_CODE', eventId },
        method: 'SHORT_CODE',
        result: 'RATE_LIMITED'
      });
      return {
        status: 429,
        result: { message: 'Rate limit exceeded for short code verification', code: 'RATE_LIMITED' }
      };
    }

    const codeHash = hashShortCode(eventId, code);
    const ticket = Array.from(eventsService.tickets.values()).find(
      t => t.eventId === eventId && t.short_code_hash === codeHash
    );

    if (!ticket) {
      this.recordFailure({ verifierLabel, eventId });
      eventsService.logEvent({
        ticketId: 'unknown',
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method: 'SHORT_CODE', eventId },
        method: 'SHORT_CODE',
        result: 'DENIED_INVALID'
      });
      return {
        status: 400,
        result: { message: 'Scan denied: Invalid short code', code: 'DENIED_INVALID' }
      };
    }

    return this.consumeEntry({
      method: 'SHORT_CODE',
      ticket,
      verifierLabel,
      eventId
    });
  }

  /**
   * Handles LOOKUP scan verification using single-use lookupToken
   */
  verifyLookupScan({ lookupToken, idChecked = false, verifierLabel }) {
    if (!lookupToken) {
      return {
        status: 400,
        result: { message: 'lookupToken is required', code: 'DENIED_INVALID' }
      };
    }

    const tokenRes = consumeLookupToken({ lookupToken, verifierLabel });
    if (!tokenRes.valid) {
      eventsService.logEvent({
        ticketId: 'unknown',
        action: 'CHECKIN_DENIED',
        actor: verifierLabel,
        payload: { method: 'LOOKUP', reason: tokenRes.reason },
        method: 'LOOKUP',
        result: 'DENIED_INVALID'
      });
      return {
        status: 400,
        result: { message: `Scan denied: ${tokenRes.reason}`, code: 'DENIED_INVALID' }
      };
    }

    const ticket = eventsService.tickets.get(tokenRes.ticketId);
    const outcome = this.consumeEntry({
      method: 'LOOKUP',
      ticket,
      verifierLabel,
      eventId: tokenRes.eventId
    });

    // Record idChecked in meta for dispute audit
    if (outcome.result) {
      outcome.result.idChecked = Boolean(idChecked);
    }
    return outcome;
  }

  /**
   * Clean expired tokens & nonces from caches
   */
  cleanExpiredTokens() {
    const now = Date.now();
    for (const [key, entry] of this.replayCache.entries()) {
      const expiry = typeof entry === 'number' ? entry : entry.expiry;
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
      eventsService.logEvent({
        ticketId: ticketId || 'unknown',
        action: 'CHECKIN_DENIED',
        actor,
        payload: { method: 'TOTP', ticketId },
        method: 'TOTP',
        result: 'DENIED_INVALID'
      });
      return {
        status: 400,
        result: { message: 'Invalid scan: Ticket record not found', code: 'DENIED_INVALID' }
      };
    }

    if (!totpToken) {
      eventsService.logEvent({
        ticketId: ticketRecord.id,
        action: 'CHECKIN_DENIED',
        actor,
        payload: { method: 'TOTP', ticketId },
        method: 'TOTP',
        result: 'DENIED_INVALID'
      });
      return {
        status: 400,
        result: { message: 'Invalid scan: totpToken missing', code: 'DENIED_INVALID' }
      };
    }

    // 1. Anti-replay check
    const cacheKey = `${ticketId}:${totpToken}`;
    const maxEntries = ticketRecord.max_entries || 1;
    const cacheEntry = this.replayCache.get(cacheKey);
    const usedCount = cacheEntry ? (typeof cacheEntry === 'number' ? 1 : cacheEntry.count) : 0;

    if (cacheEntry && usedCount >= maxEntries) {
      eventsService.logEvent({
        ticketId: ticketRecord.id,
        action: 'CHECKIN_DENIED',
        actor,
        payload: { method: 'TOTP', ticketId, totpToken },
        method: 'TOTP',
        result: 'DENIED_ALREADY_USED'
      });
      const isSingleEntry = maxEntries === 1;
      return {
        status: isSingleEntry ? 409 : 400,
        result: { message: 'Replay attack detected: Token has already been scanned', code: 'DENIED_ALREADY_USED' }
      };
    }

    // 2. Validate TOTP
    const isValid = authenticator.check(totpToken, ticketRecord.secret);
    if (!isValid) {
      eventsService.logEvent({
        ticketId: ticketRecord.id,
        action: 'CHECKIN_DENIED',
        actor,
        payload: { method: 'TOTP', ticketId, totpToken },
        method: 'TOTP',
        result: 'DENIED_INVALID'
      });
      return {
        status: 400,
        result: { message: 'Invalid or expired TOTP token', code: 'DENIED_INVALID' }
      };
    }

    // Store in replay cache with TTL (60 seconds)
    const ttlMs = 60 * 1000;
    this.replayCache.set(cacheKey, { count: usedCount + 1, expiry: Date.now() + ttlMs });

    return this.consumeEntry({
      method: 'TOTP',
      ticket: ticketRecord,
      verifierLabel: actor,
      eventId: ticketRecord.eventId
    });
  }

  /**
   * Verifies an offline signed receipt (JWS format)
   */
  verifyOfflineReceipt(receiptInput) {
    this.cleanExpiredTokens();

    if (!receiptInput) {
      return { status: 400, valid: false, reason: 'Unsupported or missing receipt payload format' };
    }

    let verifyResult;
    if (typeof receiptInput === 'string' || receiptInput.format === 'JWS') {
      const token = typeof receiptInput === 'string' ? receiptInput : receiptInput.token;
      verifyResult = signerService.verifyJWSReceipt(token);
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
      const scanMethod = typeof item === 'object' && item.method ? item.method : 'JWS';
      const itemVersion = typeof item === 'object' && item.version !== undefined ? item.version : null;

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
      const ticketRecord = eventsService.getTicketByIdOrPublicRef(ticketId);

      if (!ticketRecord) {
        results.push({
          ticketId,
          nonce: claims.nonce,
          status: 'REJECTED_NOT_FOUND',
          reason: 'Ticket ID not found in database'
        });
        continue;
      }

      const tkt = eventsService.getTicketWithDefaults(ticketRecord);

      // Version mismatch check (e.g. ticket reissued after offline manifest download)
      if (itemVersion !== null && itemVersion !== tkt.version) {
        eventsService.logEvent({
          ticketId: ticketRecord.id,
          action: 'CHECKIN_CONFLICT',
          actor: verifierId,
          payload: { claims, raw: item, offlineVersion: itemVersion, currentVersion: tkt.version },
          statusTransition: `${tkt.status} -> CHECKIN_CONFLICT (SUPERSEDED)`,
          method: scanMethod,
          result: 'DENIED_SUPERSEDED',
          meta: { offlineVersion: itemVersion, currentVersion: tkt.version }
        });

        results.push({
          ticketId,
          nonce: claims.nonce,
          status: 'REJECTED_CONFLICT',
          reason: `Ticket version mismatch: offline version v${itemVersion} vs current v${tkt.version} (DENIED_SUPERSEDED)`
        });
        continue;
      }

      if (tkt.status === 'CHECKED_IN' || tkt.entries_used >= tkt.max_entries) {
        // Log conflict in audit event log
        eventsService.logEvent({
          ticketId: ticketRecord.id,
          action: 'CHECKIN_CONFLICT',
          actor: verifierId,
          payload: { claims, raw: item },
          statusTransition: 'CHECKED_IN -> CHECKED_IN_CONFLICT',
          method: scanMethod,
          result: 'DENIED_ALREADY_USED'
        });

        results.push({
          ticketId,
          nonce: claims.nonce,
          status: 'REJECTED_CONFLICT',
          reason: 'Ticket was already checked in prior to offline reconciliation'
        });
        continue;
      }

      // Atomically transition status / increment entries
      const prevStatus = ticketRecord.status;
      ticketRecord.entries_used = (ticketRecord.entries_used || 0) + 1;
      if (ticketRecord.entries_used >= tkt.max_entries) {
        ticketRecord.status = 'CHECKED_IN';
        ticketRecord.checkedInAt = new Date().toISOString();
      }

      // Log append-only audit event for offline check-in
      eventsService.logEvent({
        ticketId: ticketRecord.id,
        action: 'CHECKIN_OFFLINE',
        actor: verifierId,
        payload: { claims, raw: item },
        statusTransition: `${prevStatus} -> ${ticketRecord.status}`,
        method: scanMethod,
        result: 'ACCEPTED'
      });

      results.push({
        ticketId,
        nonce: claims.nonce,
        status: 'ACCEPTED',
        checkedInAt: ticketRecord.checkedInAt || new Date().toISOString()
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
