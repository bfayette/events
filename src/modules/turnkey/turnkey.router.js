const express = require('express');
const router = express.Router();
const turnkeyService = require('./turnkey.service');

// POST /api/turnkey/proxy (Relay client-stamped requests directly to Turnkey)
router.post('/proxy', async (req, res) => {
  try {
    const stamp = req.headers['x-stamp'] || req.headers['x-turnkey-stamp'];
    const result = await turnkeyService.relaySignedStamp(stamp, req.body);
    return res.json(result);
  } catch (error) {
    console.error('Relay proxy failed:', error);
    return res.status(500).json({ message: 'Relay proxy failed' });
  }
});

module.exports = router;
