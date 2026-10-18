const express = require('express');
const router = express.Router();
const validationService = require('./validation.service');
const signerService = require('../passes/signer.service');
const eventsService = require('../events/events.service');

// POST /api/passes/verify (Online TOTP check-in or combined payload)
router.post('/verify', (req, res) => {
  try {
    let { ticketId, totpToken, payload, actor } = req.body;

    // Handle scanned combined payload if present e.g. "tkt_001:123456"
    if (payload && typeof payload === 'string' && payload.includes(':')) {
      const parts = payload.split(':');
      ticketId = parts[0];
      totpToken = parts[1];
    }

    if (!ticketId) {
      return res.status(400).json({ message: 'ticketId is required' });
    }

    const ticketRecord = eventsService.tickets.get(ticketId);
    const { status, result } = validationService.verifyAndCheckInTicket(
      { ticketId, totpToken, actor },
      ticketRecord
    );

    return res.status(status).json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Gate verification failed', error: error.message });
  }
});

// POST /api/passes/issue-receipt (Issue KMS-signed JWS or EIP-712 receipt)
router.post('/issue-receipt', (req, res) => {
  try {
    const { ticketId, format = 'JWS', ttlSeconds = 60, issuer, schemaVersion } = req.body;

    if (!ticketId) {
      return res.status(400).json({ message: 'ticketId is required' });
    }

    const ticketRecord = eventsService.tickets.get(ticketId);
    if (!ticketRecord) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    let receipt;
    if (format === 'EIP712') {
      receipt = signerService.generateEIP712Receipt({ ticketId, ttlSeconds, issuer, schemaVersion });
    } else {
      receipt = signerService.generateJWSReceipt({ ticketId, ttlSeconds, issuer, schemaVersion });
    }

    return res.status(201).json({
      message: 'Signed receipt generated successfully',
      receipt
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate signed receipt', error: error.message });
  }
});

// POST /api/passes/verify-receipt (Verify single signed receipt)
router.post('/verify-receipt', (req, res) => {
  try {
    const { receipt } = req.body;
    if (!receipt) {
      return res.status(400).json({ message: 'receipt is required' });
    }

    const verifyRes = validationService.verifyOfflineReceipt(receipt);
    return res.status(verifyRes.status).json(verifyRes);
  } catch (error) {
    return res.status(500).json({ message: 'Receipt verification failed', error: error.message });
  }
});

// POST /api/passes/reconcile (Batch offline scan reconciliation)
router.post('/reconcile', (req, res) => {
  try {
    const { items, receipts, verifierId = 'verifier_terminal_01' } = req.body;
    const batch = items || receipts || [];

    if (!Array.isArray(batch)) {
      return res.status(400).json({ message: 'items or receipts array is required' });
    }

    const outcome = validationService.reconcileOfflineReceipts(batch, verifierId);
    return res.status(200).json({
      message: 'Reconciliation complete',
      ...outcome
    });
  } catch (error) {
    return res.status(500).json({ message: 'Reconciliation failed', error: error.message });
  }
});

// GET /api/passes/tickets/:id/events (Retrieve ticket audit log history)
router.get('/tickets/:id/events', (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticketEvents = eventsService.getEventsForTicket(ticketId);
    return res.status(200).json({
      ticketId,
      events: ticketEvents
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to retrieve ticket audit events', error: error.message });
  }
});

module.exports = router;
