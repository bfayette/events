const express = require('express');
const router = express.Router();
const validationService = require('./validation.service');
const eventsService = require('../events/events.service');

// POST /api/passes/verify
router.post('/verify', (req, res) => {
  try {
    let { ticketId, totpToken, payload } = req.body;

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
      { ticketId, totpToken },
      ticketRecord
    );

    return res.status(status).json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Gate verification failed', error: error.message });
  }
});

module.exports = router;
