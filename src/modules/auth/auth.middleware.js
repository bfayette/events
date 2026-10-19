const { config } = require('../../config');

// Role hierarchy mapping: key role -> set of roles it satisfies
const ROLE_HIERARCHY = {
  admin: new Set(['sales', 'verifier', 'agent', 'admin']),
  agent: new Set(['sales', 'agent']),
  verifier: new Set(['verifier']),
  sales: new Set(['sales'])
};

/**
 * Middleware factory requiring one of the specified roles.
 * Sets `req.actor = { keyLabel, role, eventIds }`.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
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
    }

    if (!config.authEnforced && !token) {
      req.actor = {
        keyLabel: 'dev',
        role: 'admin',
        eventIds: undefined
      };
      return next();
    }

    if (!token) {
      return res.status(401).json({ message: 'Authentication key is required' });
    }

    const keyConfig = config.apiKeys ? config.apiKeys[token] : undefined;
    if (!keyConfig) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const userRole = keyConfig.role;
    const satisfiedRoles = ROLE_HIERARCHY[userRole] || new Set();

    const isAllowed = allowedRoles.some(role => satisfiedRoles.has(role));
    if (!isAllowed) {
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }

    req.actor = {
      keyLabel: keyConfig.label || 'unknown',
      role: userRole,
      eventIds: keyConfig.eventIds
    };

    return next();
  };
}

/**
 * Helper to check if the current actor has access to a given eventId.
 */
function checkEventScope(actor, eventId) {
  if (!actor) return false;
  if (actor.role === 'admin' || actor.eventIds === undefined) {
    return true;
  }
  if (!eventId) {
    return true;
  }
  if (Array.isArray(actor.eventIds)) {
    return actor.eventIds.includes(eventId);
  }
  return false;
}

module.exports = {
  requireRole,
  checkEventScope
};
