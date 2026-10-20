const express = require('express');
const router = express.Router();
const eventsService = require('../events/events.service');
const tokenService = require('./token.service');
const PassDataMapper = require('./pass.mapper');
const PassGeneratorService = require('./pass.generator');
const { config } = require('../../config');
const { checkEventScope } = require('../auth/auth.middleware');
const rateLimiter = require('../rateLimiter');

function checkPassRateLimits(req, res) {
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';

  // 1. Check failure limit
  const failCheck = rateLimiter.checkFailureLimit(`fail:${clientIp}`, config.rateLimitPassFailsPerMin);
  if (failCheck.limited) {
    res.set('Retry-After', String(failCheck.retryAfterSeconds));
    res.status(429).json({ message: 'Rate limit exceeded for pass downloads. Please try again later.' });
    return false;
  }

  // 2. Check general request limit
  const genCheck = rateLimiter.checkAndRecordGeneral(clientIp, config.rateLimitPassRequestsPerMin);
  if (genCheck.limited) {
    res.set('Retry-After', String(genCheck.retryAfterSeconds));
    res.status(429).json({ message: 'Too many requests. Please try again later.' });
    return false;
  }

  return true;
}

function recordPassFailure(req) {
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  rateLimiter.recordFailure(`fail:${clientIp}`);
}

/**
 * Authenticate pass requests:
 * Header channel: accepts valid staff API key (sales, agent, admin) with event scope OR valid holder/download token.
 * Query string channel (?token=): accepts ONLY a valid 5-minute download token (scope === 'pass:download').
 */
function authenticatePassRequest(req, ticket) {
  let headerToken;
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    headerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  } else if (req.headers['x-api-key']) {
    headerToken = String(req.headers['x-api-key']).trim();
  }

  // If header credential provided
  if (headerToken) {
    const keyConfig = config.apiKeys ? config.apiKeys[headerToken] : undefined;
    if (keyConfig) {
      const allowedRoles = new Set(['sales', 'agent', 'admin']);
      if (!allowedRoles.has(keyConfig.role)) {
        return { authenticated: false, status: 403, message: 'Forbidden: Insufficient permissions' };
      }
      const actor = {
        keyLabel: keyConfig.label || 'unknown',
        role: keyConfig.role,
        eventIds: keyConfig.eventIds
      };
      if (!checkEventScope(actor, ticket.eventId)) {
        return { authenticated: false, status: 403, message: `Forbidden: Access denied for event ${ticket.eventId}` };
      }
      return { authenticated: true, type: 'staff', actor };
    }

    const tokenRes = tokenService.verifyTokenForTicket(headerToken, ticket);
    if (tokenRes.valid) {
      return { authenticated: true, type: 'holder', claims: tokenRes.claims };
    }

    return { authenticated: false, status: 401, message: tokenRes.reason || 'Invalid credentials' };
  }

  // If query string credential provided (?token=)
  const queryToken = req.query && req.query.token ? String(req.query.token).trim() : null;
  if (queryToken) {
    // Only accept 5-minute download tokens via query string; do not attempt API key lookup or holder token match
    const dlRes = tokenService.verifyDownloadToken(queryToken);
    if (dlRes.valid) {
      const ticketVersion = ticket.version !== undefined ? ticket.version : 1;
      if (dlRes.claims.sub === ticket.public_ref && dlRes.claims.ver === ticketVersion) {
        return { authenticated: true, type: 'holder', claims: dlRes.claims };
      }
      if (dlRes.claims.sub !== ticket.public_ref) {
        return { authenticated: false, status: 401, message: 'Token subject mismatch: token is for a different ticket' };
      }
      if (dlRes.claims.ver !== ticketVersion) {
        return { authenticated: false, status: 401, message: `Token version mismatch: v${dlRes.claims.ver} superseded by ticket v${ticketVersion}` };
      }
    }
    return { authenticated: false, status: 401, message: 'Invalid or missing download token in query string' };
  }

  return { authenticated: false, status: 401, message: 'Authentication required' };
}

// Helper to set security headers on pass responses
function setPassSecurityHeaders(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

// GET /api/tickets/:public_ref/apple-pass
router.get('/tickets/:public_ref/apple-pass', async (req, res) => {
  try {
    setPassSecurityHeaders(res);
    if (!checkPassRateLimits(req, res)) {
      return;
    }

    const publicRef = req.params.public_ref;
    const ticket = eventsService.getTicketByPublicRef(publicRef);
    if (!ticket) {
      recordPassFailure(req);
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (ticket.status === 'REVOKED') {
      recordPassFailure(req);
      return res.status(403).json({ message: 'Ticket has been revoked', code: 'TICKET_REVOKED' });
    }

    const auth = authenticatePassRequest(req, ticket);
    if (!auth.authenticated) {
      recordPassFailure(req);
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
    setPassSecurityHeaders(res);
    if (!checkPassRateLimits(req, res)) {
      return;
    }

    const publicRef = req.params.public_ref;
    const ticket = eventsService.getTicketByPublicRef(publicRef);
    if (!ticket) {
      recordPassFailure(req);
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (ticket.status === 'REVOKED') {
      recordPassFailure(req);
      return res.status(403).json({ message: 'Ticket has been revoked', code: 'TICKET_REVOKED' });
    }

    const auth = authenticatePassRequest(req, ticket);
    if (!auth.authenticated) {
      recordPassFailure(req);
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
