const express = require('express');
const router = express.Router();
const { authenticator } = require('otplib');
const eventsService = require('./events.service');
const signerService = require('../passes/signer.service');
const tokenService = require('../passes/token.service');
const { generateShortCode, hashShortCode } = require('../passes/shortcode.service');
const { requireRole, checkEventScope } = require('../auth/auth.middleware');
const { config } = require('../../config');
const notifierService = require('./notifier.service');
const rateLimiter = require('../rateLimiter');

function checkTokenRateLimits(req, res) {
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';

  const failCheck = rateLimiter.checkFailureLimit(`fail:${clientIp}`, config.rateLimitPassFailsPerMin);
  if (failCheck.limited) {
    res.set('Retry-After', String(failCheck.retryAfterSeconds));
    res.status(429).json({ message: 'Rate limit exceeded for token requests. Please try again later.' });
    return false;
  }

  const genCheck = rateLimiter.checkAndRecordGeneral(clientIp, config.rateLimitPassRequestsPerMin);
  if (genCheck.limited) {
    res.set('Retry-After', String(genCheck.retryAfterSeconds));
    res.status(429).json({ message: 'Too many requests. Please try again later.' });
    return false;
  }

  return true;
}

function recordTokenFailure(req) {
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  rateLimiter.recordFailure(`fail:${clientIp}`);
}

// POST /api/tickets (Issue new ticket)
router.post('/', requireRole('sales', 'agent', 'admin'), (req, res) => {
  try {
    const {
      eventId,
      codeMode = 'TOTP',
      holderName,
      holderPhone,
      ownerEmail,
      maxEntries = 1,
      anonymous = false,
      seat,
      section,
      holderBinding
    } = req.body;

    if (!eventId) {
      return res.status(400).json({ message: 'eventId is required' });
    }

    const rawEvent = eventsService.events.get(eventId);
    if (!rawEvent) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (!checkEventScope(req.actor, eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${eventId}` });
    }

    const event = eventsService.getEventWithDefaults(rawEvent);
    const allowedModes = event.allowed_code_modes || ['TOTP'];
    if (!allowedModes.includes(codeMode)) {
      return res.status(422).json({
        message: `Code mode '${codeMode}' is not allowed for event '${eventId}'. Allowed modes: ${allowedModes.join(', ')}`
      });
    }

    const isSalesRole = req.actor && (req.actor.role === 'sales' || req.actor.role === 'agent' || req.actor.role === 'admin');
    const contactCheck = eventsService.validateTicketContactInfo({
      holder_name: holderName,
      holder_phone: holderPhone,
      owner_email: ownerEmail,
      anonymous,
      isSalesRole
    });

    if (!contactCheck.valid) {
      return res.status(400).json({ message: contactCheck.reason });
    }

    const ticketId = `tkt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const publicRef = eventsService.generatePublicRef();
    const normalizedPhone = eventsService.normalizePhone(holderPhone);

    let secret = null;
    let shortCode = null;
    let shortCodeHash = null;
    let qrPayload = null;

    if (codeMode === 'STATIC') {
      secret = null;

      let attempts = 0;
      do {
        shortCode = generateShortCode();
        shortCodeHash = hashShortCode(eventId, shortCode);
        attempts++;
        const collision = Array.from(eventsService.tickets.values()).some(
          t => t.eventId === eventId && t.short_code_hash === shortCodeHash
        );
        if (!collision) break;
      } while (attempts < 10);

      const staticCode = signerService.generateStaticCode({
        ticketId: publicRef,
        version: 1,
        eventId
      });
      qrPayload = staticCode.qrPayload;
    } else {
      secret = authenticator.generateSecret();
    }

    const ticketRecord = {
      id: ticketId,
      public_ref: publicRef,
      eventId,
      owner_email: ownerEmail ? String(ownerEmail).trim() : null,
      secret,
      seat: seat || null,
      section: section || null,
      status: 'ISSUED',
      code_mode: codeMode,
      version: 1,
      max_entries: Math.max(1, parseInt(maxEntries, 10) || 1),
      entries_used: 0,
      holder_name: holderName ? String(holderName).trim() : null,
      holder_phone: normalizedPhone,
      holder_binding: holderBinding || { type: 'none' },
      short_code_hash: shortCodeHash,
      reissue_count: 0
    };

    eventsService.tickets.set(ticketId, ticketRecord);

    eventsService.logEvent({
      ticketId,
      action: codeMode === 'STATIC' ? 'ISSUE_STATIC' : 'ISSUE',
      actor: req.actor ? req.actor.keyLabel : 'system',
      payload: {
        ticketId,
        publicRef,
        eventId,
        codeMode,
        version: 1,
        maxEntries: ticketRecord.max_entries,
        anonymous: contactCheck.anonymous
      },
      statusTransition: 'NONE -> ISSUED',
      method: codeMode === 'STATIC' ? 'STATIC_QR' : 'TOTP',
      result: 'ACCEPTED'
    });

    const holderToken = tokenService.generateHolderToken({
      publicRef,
      version: 1,
      holderIdentifier: ticketRecord.owner_email || ticketRecord.holder_name || ticketRecord.holder_phone
    });

    const applePassUrl = `/api/tickets/${publicRef}/apple-pass`;
    const googlePassUrl = `/api/tickets/${publicRef}/google-pass-url`;

    if (codeMode === 'STATIC') {
      return res.status(201).json({
        message: 'Ticket issued successfully',
        ticket: eventsService.getTicketWithDefaults(ticketRecord),
        qrPayload,
        shortCode,
        holderToken,
        applePassUrl,
        googlePassUrl
      });
    }

    return res.status(201).json({
      message: 'Ticket issued successfully',
      ticket: eventsService.getTicketWithDefaults(ticketRecord),
      holderToken,
      applePassUrl,
      googlePassUrl
    });
  } catch (error) {
    console.error('Failed to issue ticket:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/tickets/:public_ref/tokens (Mint fresh holder token - STAFF ONLY)
router.post('/:public_ref/tokens', (req, res) => {
  try {
    if (!checkTokenRateLimits(req, res)) {
      return;
    }

    const publicRef = req.params.public_ref;
    const ticketRecord = eventsService.getTicketByPublicRef(publicRef);
    if (!ticketRecord) {
      recordTokenFailure(req);
      return res.status(404).json({ message: 'Ticket not found' });
    }

    let token;
    const authHeader = req.headers['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    } else if (req.headers['x-api-key']) {
      token = String(req.headers['x-api-key']).trim();
    }

    let actor;
    if (!config.authEnforced && !token) {
      actor = { keyLabel: 'dev', role: 'admin', eventIds: undefined };
    } else if (token) {
      const keyConfig = config.apiKeys ? config.apiKeys[token] : undefined;
      if (keyConfig) {
        const allowedRoles = new Set(['sales', 'agent', 'admin']);
        if (!allowedRoles.has(keyConfig.role)) {
          recordTokenFailure(req);
          return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
        }
        actor = {
          keyLabel: keyConfig.label || 'unknown',
          role: keyConfig.role,
          eventIds: keyConfig.eventIds
        };
      }
    }

    if (!actor) {
      recordTokenFailure(req);
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!checkEventScope(actor, ticketRecord.eventId)) {
      recordTokenFailure(req);
      return res.status(403).json({ message: `Forbidden: Access denied for event ${ticketRecord.eventId}` });
    }

    if (ticketRecord.status === 'REVOKED') {
      recordTokenFailure(req);
      return res.status(403).json({ message: 'Ticket has been revoked', code: 'TICKET_REVOKED' });
    }

    const holderToken = tokenService.generateHolderToken({
      publicRef: ticketRecord.public_ref,
      version: ticketRecord.version,
      holderIdentifier: ticketRecord.owner_email || ticketRecord.holder_name || ticketRecord.holder_phone
    });

    return res.json({ holderToken });
  } catch (error) {
    console.error('Failed to mint holder token:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/tickets/:public_ref/download-token (Mint 5-minute pass download token)
router.post('/:public_ref/download-token', (req, res) => {
  try {
    if (!checkTokenRateLimits(req, res)) {
      return;
    }

    const publicRef = req.params.public_ref;
    const ticketRecord = eventsService.getTicketByPublicRef(publicRef);
    if (!ticketRecord) {
      recordTokenFailure(req);
      return res.status(404).json({ message: 'Ticket not found' });
    }

    let token;
    const authHeader = req.headers['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    } else if (req.headers['x-api-key']) {
      token = String(req.headers['x-api-key']).trim();
    }

    let isAuthorized = false;
    let isStaff = false;
    let actor;

    if (!config.authEnforced && !token) {
      actor = { keyLabel: 'dev', role: 'admin', eventIds: undefined };
      isAuthorized = true;
      isStaff = true;
    } else if (token) {
      const keyConfig = config.apiKeys ? config.apiKeys[token] : undefined;
      if (keyConfig) {
        const allowedRoles = new Set(['sales', 'agent', 'admin']);
        if (!allowedRoles.has(keyConfig.role)) {
          recordTokenFailure(req);
          return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
        }
        actor = {
          keyLabel: keyConfig.label || 'unknown',
          role: keyConfig.role,
          eventIds: keyConfig.eventIds
        };
        isAuthorized = true;
        isStaff = true;
      } else {
        const verifyRes = tokenService.verifyHolderToken(token);
        if (verifyRes.valid && verifyRes.claims.sub === ticketRecord.public_ref && verifyRes.claims.ver === ticketRecord.version) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      recordTokenFailure(req);
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (isStaff && !checkEventScope(actor, ticketRecord.eventId)) {
      recordTokenFailure(req);
      return res.status(403).json({ message: `Forbidden: Access denied for event ${ticketRecord.eventId}` });
    }

    if (ticketRecord.status === 'REVOKED') {
      recordTokenFailure(req);
      return res.status(403).json({ message: 'Ticket has been revoked', code: 'TICKET_REVOKED' });
    }

    const downloadToken = tokenService.generateDownloadToken({
      publicRef: ticketRecord.public_ref,
      version: ticketRecord.version,
      ttlSeconds: 300
    });

    return res.json({ downloadToken, expiresIn: 300 });
  } catch (error) {
    console.error('Failed to mint download token:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/tickets/:id/reissue (Reissue ticket)
router.post('/:id/reissue', requireRole('agent', 'admin'), (req, res) => {
  try {
    const identifier = req.params.id;
    const ticketRecord = eventsService.getTicketByIdOrPublicRef(identifier);

    if (!ticketRecord) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (!checkEventScope(req.actor, ticketRecord.eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${ticketRecord.eventId}` });
    }

    const { recoveryMethod, newCodeMode, note } = req.body;
    const ALLOWED_RECOVERY_METHODS = new Set(['phone_lookup', 'id_check', 'purchase_receipt', 'admin_override']);

    if (!recoveryMethod || !ALLOWED_RECOVERY_METHODS.has(recoveryMethod)) {
      return res.status(400).json({
        message: `Invalid or missing recoveryMethod. Allowed: ${Array.from(ALLOWED_RECOVERY_METHODS).join(', ')}`
      });
    }

    const isAdmin = req.actor && req.actor.role === 'admin';

    if (recoveryMethod === 'admin_override') {
      if (!isAdmin) {
        return res.status(403).json({ message: 'admin_override recovery method requires admin role' });
      }
      if (!note || !String(note).trim()) {
        return res.status(400).json({ message: 'admin_override recovery method requires a non-empty note' });
      }
    }

    const currentDefaults = eventsService.getTicketWithDefaults(ticketRecord);
    const isFullyUsed = currentDefaults.entries_used >= currentDefaults.max_entries;
    const isRevoked = currentDefaults.status === 'REVOKED';

    if ((isFullyUsed || isRevoked) && recoveryMethod !== 'admin_override') {
      return res.status(400).json({
        message: 'Cannot reissue a ticket that is fully used or revoked without admin_override'
      });
    }

    const maxCap = config.maxReissuesPerTicket || 3;
    if (currentDefaults.reissue_count >= maxCap && recoveryMethod !== 'admin_override') {
      return res.status(400).json({
        message: `Ticket has reached the maximum reissue cap (${maxCap}). Further reissues require admin_override`
      });
    }

    // Apply Reissue
    const oldVersion = currentDefaults.version;
    const newVersion = oldVersion + 1;
    ticketRecord.version = newVersion;
    ticketRecord.reissue_count = (currentDefaults.reissue_count || 0) + 1;

    const targetMode = newCodeMode || currentDefaults.code_mode || 'TOTP';
    ticketRecord.code_mode = targetMode;

    let shortCode = null;
    let qrPayload = null;

    if (targetMode === 'STATIC') {
      ticketRecord.secret = null;
      let attempts = 0;
      let shortCodeHash = null;
      do {
        shortCode = generateShortCode();
        shortCodeHash = hashShortCode(ticketRecord.eventId, shortCode);
        attempts++;
        const collision = Array.from(eventsService.tickets.values()).some(
          t => t.id !== ticketRecord.id && t.eventId === ticketRecord.eventId && t.short_code_hash === shortCodeHash
        );
        if (!collision) break;
      } while (attempts < 10);

      ticketRecord.short_code_hash = shortCodeHash;

      const staticCode = signerService.generateStaticCode({
        ticketId: ticketRecord.public_ref,
        version: newVersion,
        eventId: ticketRecord.eventId
      });
      qrPayload = staticCode.qrPayload;
    } else {
      ticketRecord.secret = authenticator.generateSecret();
      ticketRecord.short_code_hash = null;
    }

    notifierService.notifyReissue(ticketRecord);

    eventsService.logEvent({
      ticketId: ticketRecord.id,
      action: 'REISSUE',
      actor: req.actor ? req.actor.keyLabel : 'system',
      payload: {
        ticketId: ticketRecord.id,
        publicRef: ticketRecord.public_ref,
        eventId: ticketRecord.eventId,
        recoveryMethod,
        oldVersion,
        newVersion,
        reissueCount: ticketRecord.reissue_count
      },
      statusTransition: `${currentDefaults.status} (v${oldVersion} -> v${newVersion})`,
      method: targetMode === 'STATIC' ? 'STATIC_QR' : 'TOTP',
      result: 'ACCEPTED',
      meta: {
        recoveryMethod,
        oldVersion,
        newVersion,
        reissueCount: ticketRecord.reissue_count,
        note: note ? String(note).trim() : null
      }
    });

    const holderToken = tokenService.generateHolderToken({
      publicRef: ticketRecord.public_ref,
      version: newVersion,
      holderIdentifier: ticketRecord.owner_email || ticketRecord.holder_name || ticketRecord.holder_phone
    });

    const applePassUrl = `/api/tickets/${ticketRecord.public_ref}/apple-pass`;
    const googlePassUrl = `/api/tickets/${ticketRecord.public_ref}/google-pass-url`;

    if (targetMode === 'STATIC') {
      return res.status(200).json({
        message: 'Ticket reissued successfully',
        ticket: eventsService.getTicketWithDefaults(ticketRecord),
        qrPayload,
        shortCode,
        holderToken,
        applePassUrl,
        googlePassUrl
      });
    }

    return res.status(200).json({
      message: 'Ticket reissued successfully',
      ticket: eventsService.getTicketWithDefaults(ticketRecord),
      holderToken,
      applePassUrl,
      googlePassUrl
    });
  } catch (error) {
    console.error('Failed to reissue ticket:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
