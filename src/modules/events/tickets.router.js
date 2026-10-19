const express = require('express');
const router = express.Router();
const { authenticator } = require('otplib');
const eventsService = require('./events.service');
const signerService = require('../passes/signer.service');
const { generateShortCode, hashShortCode } = require('../passes/shortcode.service');
const { requireRole, checkEventScope } = require('../auth/auth.middleware');

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
    const normalizedPhone = eventsService.normalizePhone(holderPhone);

    let secret = null;
    let shortCode = null;
    let shortCodeHash = null;
    let qrPayload = null;

    if (codeMode === 'STATIC') {
      // Static ticket: no TOTP secret
      secret = null;

      // Generate unique short code for event
      let attempts = 0;
      do {
        shortCode = generateShortCode();
        shortCodeHash = hashShortCode(eventId, shortCode);
        attempts++;
        // Check collision across existing tickets for this event
        const collision = Array.from(eventsService.tickets.values()).some(
          t => t.eventId === eventId && t.short_code_hash === shortCodeHash
        );
        if (!collision) break;
      } while (attempts < 10);

      const staticCode = signerService.generateStaticCode({
        ticketId,
        version: 1,
        eventId
      });
      qrPayload = staticCode.qrPayload;
    } else {
      // TOTP ticket: generate Base32 TOTP secret
      secret = authenticator.generateSecret();
    }

    const ticketRecord = {
      id: ticketId,
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

    if (codeMode === 'STATIC') {
      return res.status(201).json({
        message: 'Ticket issued successfully',
        ticket: eventsService.getTicketWithDefaults(ticketRecord),
        qrPayload,
        shortCode
      });
    }

    return res.status(201).json({
      message: 'Ticket issued successfully',
      ticket: eventsService.getTicketWithDefaults(ticketRecord),
      applePassUrl: `/api/tickets/${ticketId}/apple-pass`,
      googlePassUrl: `/api/tickets/${ticketId}/google-pass-url`
    });
  } catch (error) {
    console.error('Failed to issue ticket:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

const { config } = require('../../config');
const notifierService = require('./notifier.service');

// POST /api/tickets/:id/reissue (Reissue ticket, bumping version and revoking previous carrier)
router.post('/:id/reissue', requireRole('agent', 'admin'), (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticketRecord = eventsService.tickets.get(ticketId);

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
          t => t.id !== ticketId && t.eventId === ticketRecord.eventId && t.short_code_hash === shortCodeHash
        );
        if (!collision) break;
      } while (attempts < 10);

      ticketRecord.short_code_hash = shortCodeHash;

      const staticCode = signerService.generateStaticCode({
        ticketId: ticketRecord.id,
        version: newVersion,
        eventId: ticketRecord.eventId
      });
      qrPayload = staticCode.qrPayload;
    } else {
      ticketRecord.secret = authenticator.generateSecret();
      ticketRecord.short_code_hash = null;
    }

    // Call notification interface
    notifierService.notifyReissue(ticketRecord);

    eventsService.logEvent({
      ticketId: ticketRecord.id,
      action: 'REISSUE',
      actor: req.actor ? req.actor.keyLabel : 'system',
      payload: {
        ticketId: ticketRecord.id,
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

    if (targetMode === 'STATIC') {
      return res.status(200).json({
        message: 'Ticket reissued successfully',
        ticket: eventsService.getTicketWithDefaults(ticketRecord),
        qrPayload,
        shortCode
      });
    }

    return res.status(200).json({
      message: 'Ticket reissued successfully',
      ticket: eventsService.getTicketWithDefaults(ticketRecord),
      applePassUrl: `/api/tickets/${ticketRecord.id}/apple-pass`,
      googlePassUrl: `/api/tickets/${ticketRecord.id}/google-pass-url`
    });
  } catch (error) {
    console.error('Failed to reissue ticket:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
