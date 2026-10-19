const express = require('express');
const router = express.Router();
const { requireRole, checkEventScope } = require('../auth/auth.middleware');
const { searchCandidates } = require('./lookup.service');
const validationService = require('./validation.service');

// POST /api/lookup (Search candidates for manual gate lookup)
router.post('/', requireRole('verifier'), (req, res) => {
  try {
    const { eventId, phone, name, secondFactor } = req.body;
    const verifierLabel = req.actor ? req.actor.keyLabel : 'system';

    if (!eventId) {
      return res.status(400).json({ message: 'eventId is required' });
    }

    if (!checkEventScope(req.actor, eventId)) {
      return res.status(403).json({ message: `Forbidden: Access denied for event ${eventId}` });
    }

    const rateCheck = validationService.checkRateLimit({ verifierLabel, eventId });
    if (rateCheck.limited) {
      return res.status(429).json({ message: 'Rate limit exceeded for lookup search', code: 'RATE_LIMITED' });
    }

    const outcome = searchCandidates({
      eventId,
      phone,
      name,
      secondFactor,
      verifierLabel
    });

    if (outcome.result && outcome.result.count === 0) {
      validationService.recordFailure({ verifierLabel, eventId });
    }

    return res.status(outcome.status).json(outcome.result);
  } catch (error) {
    console.error('Lookup search failed:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
