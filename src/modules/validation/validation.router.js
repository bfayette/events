const express = require('express');
const router = express.Router();
const validationService = require('./validation.service');
const signerService = require('../passes/signer.service');
const eventsService = require('../events/events.service');
const { requireRole, checkEventScope } = require('../auth/auth.middleware');

// POST /api/passes/verify (Online gate check-in for TOTP, STATIC_QR, SHORT_CODE, and LOOKUP)
router.post('/verify', requireRole('verifier'), (req, res) => {
  try {
    let { ticketId, totpToken, payload, method, code, eventId } = req.body;
    const actorLabel = req.actor ? req.actor.keyLabel : 'system';

    const scanMethod = method || 'TOTP';

    if (scanMethod === 'STATIC_QR') {
      const outcome = validationService.verifyStaticQrScan({
        payload,
        eventId,
        verifierLabel: actorLabel,
        actor: req.actor
      });
      return res.status(outcome.status).json(outcome.result);
    }

    if (scanMethod === 'LOOKUP') {
      const outcome = validationService.verifyLookupScan({
        lookupToken: req.body.lookupToken,
        idChecked: Boolean(req.body.idChecked),
        verifierLabel: actorLabel
      });
      return res.status(outcome.status).json(outcome.result);
    }

    if (scanMethod === 'SHORT_CODE') {
      if (eventId && !checkEventScope(req.actor, eventId)) {
        return res.status(403).json({ message: `Forbidden: Access denied for event ${eventId}` });
      }
      const outcome = validationService.verifyShortCodeScan({
        code,
        eventId,
        verifierLabel: actorLabel,
        ip: req.ip
      });
      if (outcome.status === 429) {
        res.set('Retry-After', '60');
      }
      return res.status(outcome.status).json(outcome.result);
    }

    // Default: TOTP scan
    if (payload && typeof payload === 'string' && payload.includes(':')) {
      const parts = payload.split(':');
      ticketId = parts[0];
      totpToken = parts[1];
    }

    if (!ticketId) {
      return res.status(400).json({ message: 'ticketId is required' });
    }

    const ticketRecord = eventsService.getTicketByIdOrPublicRef(ticketId);
    if (ticketRecord && !checkEventScope(req.actor, ticketRecord.eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${ticketRecord.eventId}` });
    }
    if (eventId && !checkEventScope(req.actor, eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${eventId}` });
    }

    const { status, result } = validationService.verifyAndCheckInTicket(
      { ticketId: ticketRecord ? ticketRecord.public_ref : ticketId, totpToken, actor: actorLabel },
      ticketRecord
    );

    return res.status(status).json(result);
  } catch (error) {
    console.error('Gate verification failed:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/passes/issue-receipt (Issue signed JWS receipt)
router.post('/issue-receipt', requireRole('verifier', 'agent', 'sales'), (req, res) => {
  try {
    const { ticketId, format = 'JWS', ttlSeconds = 60, issuer, schemaVersion } = req.body;

    if (!ticketId) {
      return res.status(400).json({ message: 'ticketId is required' });
    }

    if (format !== 'JWS') {
      return res.status(400).json({ message: "Unsupported receipt format. Only 'JWS' is supported" });
    }

    const ticketRecord = eventsService.getTicketByIdOrPublicRef(ticketId);
    if (!ticketRecord) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (!checkEventScope(req.actor, ticketRecord.eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${ticketRecord.eventId}` });
    }

    const receipt = signerService.generateJWSReceipt({ ticketId: ticketRecord.public_ref, ttlSeconds, issuer, schemaVersion });

    return res.status(201).json({
      message: 'Signed receipt generated successfully',
      receipt
    });
  } catch (error) {
    console.error('Failed to generate signed receipt:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/passes/verify-receipt (Verify single signed receipt)
router.post('/verify-receipt', requireRole('verifier'), (req, res) => {
  try {
    const { receipt } = req.body;
    if (!receipt) {
      return res.status(400).json({ message: 'receipt is required' });
    }

    const verifyRes = validationService.verifyOfflineReceipt(receipt);
    return res.status(verifyRes.status).json(verifyRes);
  } catch (error) {
    console.error('Receipt verification failed:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/passes/reconcile (Batch offline scan reconciliation)
router.post('/reconcile', requireRole('verifier'), (req, res) => {
  try {
    const { items, receipts } = req.body;
    const verifierLabel = req.actor ? req.actor.keyLabel : 'verifier_terminal_01';
    const batch = items || receipts || [];

    if (!Array.isArray(batch)) {
      return res.status(400).json({ message: 'items or receipts array is required' });
    }

    const outcome = validationService.reconcileOfflineReceipts(batch, verifierLabel);
    return res.status(200).json({
      message: 'Reconciliation complete',
      ...outcome
    });
  } catch (error) {
    console.error('Reconciliation failed:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/passes/tickets/:id/events (Retrieve ticket audit log history)
router.get('/tickets/:id/events', requireRole('verifier', 'agent', 'sales'), (req, res) => {
  try {
    const identifier = req.params.id;
    const ticketRecord = eventsService.getTicketByIdOrPublicRef(identifier);
    if (ticketRecord && !checkEventScope(req.actor, ticketRecord.eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${ticketRecord.eventId}` });
    }
    const internalId = ticketRecord ? ticketRecord.id : identifier;
    const ticketEvents = eventsService.getEventsForTicket(internalId);
    return res.status(200).json({
      ticketId: ticketRecord ? ticketRecord.public_ref : identifier,
      events: ticketEvents
    });
  } catch (error) {
    console.error('Failed to retrieve ticket audit events:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
