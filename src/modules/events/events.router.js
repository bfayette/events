const express = require('express');
const router = express.Router();
const eventsService = require('./events.service');
const { requireRole, checkEventScope } = require('../auth/auth.middleware');

router.get('/', (req, res) => {
  res.json(Array.from(eventsService.events.values()));
});

router.get('/:id', (req, res) => {
  const event = eventsService.events.get(req.params.id);
  if (!event) {
    return res.status(404).json({ message: 'Event not found' });
  }
  res.json(event);
});

// GET /api/events/:id/manifest (Offline manifest for static QR tickets)
router.get('/:id/manifest', requireRole('verifier'), (req, res) => {
  try {
    const eventId = req.params.id;
    const event = eventsService.events.get(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (!checkEventScope(req.actor, eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${eventId}` });
    }

    /*
     * Known limit: A reissue after the manifest was downloaded is invisible offline,
     * so the old paper copy can still be accepted until online reconciliation occurs.
     * Reconciliation version checking mitigates this by flagging version mismatches as CHECKIN_CONFLICT.
     */
    const manifest = [];
    for (const rawTicket of eventsService.tickets.values()) {
      if (rawTicket.eventId === eventId && rawTicket.code_mode === 'STATIC') {
        const tkt = eventsService.getTicketWithDefaults(rawTicket);
        manifest.push({
          ticket_id: tkt.id,
          version: tkt.version,
          entries_used: tkt.entries_used,
          max_entries: tkt.max_entries,
          status: tkt.status
        });
      }
    }

    return res.status(200).json({
      eventId,
      count: manifest.length,
      manifest
    });
  } catch (error) {
    console.error('Failed to generate offline manifest:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
