const express = require('express');
const router = express.Router();
const eventsService = require('../events/events.service');
const tokenService = require('./token.service');
const PassDataMapper = require('./pass.mapper');
const PassGeneratorService = require('./pass.generator');
const { config } = require('../../config');

/**
 * Authenticate pass requests: accepts valid staff API key OR valid holder/download token for the ticket.
 */
function authenticatePassRequest(req, ticket) {
  let token;
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = authHeader.trim();
    }
  } else if (req.headers['x-api-key']) {
    token = String(req.headers['x-api-key']).trim();
  } else if (req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token) {
    return { authenticated: false, status: 401, message: 'Authentication required' };
  }

  const keyConfig = config.apiKeys ? config.apiKeys[token] : undefined;
  if (keyConfig) {
    const allowedRoles = new Set(['sales', 'agent', 'verifier', 'admin']);
    if (allowedRoles.has(keyConfig.role)) {
      return { authenticated: true, type: 'staff' };
    }
  }

  const tokenRes = tokenService.verifyTokenForTicket(token, ticket);
  if (tokenRes.valid) {
    return { authenticated: true, type: 'holder', claims: tokenRes.claims };
  }

  return { authenticated: false, status: 401, message: tokenRes.reason || 'Invalid credentials' };
}

// GET /api/tickets/:public_ref/apple-pass
router.get('/tickets/:public_ref/apple-pass', async (req, res) => {
  try {
    const publicRef = req.params.public_ref;
    const ticket = eventsService.getTicketByPublicRef(publicRef);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const auth = authenticatePassRequest(req, ticket);
    if (!auth.authenticated) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const event = eventsService.events.get(ticket.eventId);
    const applePassData = PassDataMapper.toAppleEventPass(ticket, event);
    const pkpassBuffer = await PassGeneratorService.createApplePkPassBuffer(applePassData);

    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Content-Disposition', `attachment; filename=ticket-${ticket.public_ref}.pkpass`);
    return res.send(pkpassBuffer);
  } catch (error) {
    console.error('Error generating Apple Pass:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/tickets/:public_ref/google-pass-url
router.get('/tickets/:public_ref/google-pass-url', (req, res) => {
  try {
    const publicRef = req.params.public_ref;
    const ticket = eventsService.getTicketByPublicRef(publicRef);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const auth = authenticatePassRequest(req, ticket);
    if (!auth.authenticated) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const event = eventsService.events.get(ticket.eventId);
    const googleClaims = PassDataMapper.toGoogleEventPass(ticket, event);
    const saveUrl = PassGeneratorService.createGoogleWalletSaveUrl(googleClaims);

    return res.json({ saveUrl, claims: googleClaims });
  } catch (error) {
    console.error('Error generating Google Pass URL:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
