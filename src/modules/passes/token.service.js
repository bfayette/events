const jwt = require('jsonwebtoken');
const { config } = require('../../config');

class TokenService {
  constructor() {
    this.secret = process.env.HOLDER_TOKEN_SECRET || config.operatorSecret;
  }

  /**
   * Generates a signed Holder Token JWT (TTL default = 7 days)
   */
  generateHolderToken({ publicRef, version = 1, holderIdentifier = null, ttlDays = 7 }) {
    if (!publicRef) {
      throw new Error('publicRef is required to generate holder token');
    }

    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(1, ttlDays * 86400);

    const payload = {
      sub: publicRef,
      ver: version,
      aud: 'ticket-holder',
      holder: holderIdentifier || null,
      iat: now,
      exp: now + ttlSeconds
    };

    return jwt.sign(payload, this.secret, { algorithm: 'HS256' });
  }

  /**
   * Verifies a Holder Token JWT
   */
  verifyHolderToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'Missing or malformed holder token' };
    }

    try {
      const claims = jwt.verify(token, this.secret, { algorithms: ['HS256'] });

      if (claims.aud !== 'ticket-holder') {
        return { valid: false, reason: `Invalid token audience '${claims.aud}'; expected 'ticket-holder'` };
      }

      if (!claims.sub) {
        return { valid: false, reason: 'Token missing subject (sub)' };
      }

      return { valid: true, claims };
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return { valid: false, reason: 'Holder token has expired' };
      }
      return { valid: false, reason: 'Holder token signature verification failed' };
    }
  }

  /**
   * Generates a short-lived Pass Download Token JWT (TTL default = 5 minutes)
   */
  generateDownloadToken({ publicRef, version = 1, ttlSeconds = 300 }) {
    if (!publicRef) {
      throw new Error('publicRef is required to generate download token');
    }

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: publicRef,
      ver: version,
      scope: 'pass:download',
      iat: now,
      exp: now + ttlSeconds
    };

    return jwt.sign(payload, this.secret, { algorithm: 'HS256' });
  }

  /**
   * Verifies a Pass Download Token JWT
   */
  verifyDownloadToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'Missing or malformed download token' };
    }

    try {
      const claims = jwt.verify(token, this.secret, { algorithms: ['HS256'] });

      if (claims.scope !== 'pass:download') {
        return { valid: false, reason: `Invalid token scope '${claims.scope}'; expected 'pass:download'` };
      }

      if (!claims.sub) {
        return { valid: false, reason: 'Token missing subject (sub)' };
      }

      return { valid: true, claims };
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return { valid: false, reason: 'Download token has expired' };
      }
      return { valid: false, reason: 'Download token signature verification failed' };
    }
  }

  /**
   * Verifies either a holder token or download token against a specific ticket.
   * Ensures sub matches ticket.public_ref and ver matches ticket.version.
   */
  verifyTokenForTicket(token, ticket) {
    if (!token || typeof token !== 'string' || !ticket) {
      return { valid: false, reason: 'Token and ticket record are required' };
    }

    let result = this.verifyDownloadToken(token);
    if (!result.valid) {
      result = this.verifyHolderToken(token);
    }

    if (!result.valid) {
      return { valid: false, reason: result.reason };
    }

    const { claims } = result;

    if (claims.sub !== ticket.public_ref) {
      return { valid: false, reason: 'Token subject mismatch: token is for a different ticket' };
    }

    const ticketVersion = ticket.version !== undefined ? ticket.version : 1;
    if (claims.ver !== undefined && claims.ver !== ticketVersion) {
      return { valid: false, reason: `Token version mismatch: v${claims.ver} superseded by ticket v${ticketVersion}` };
    }

    return { valid: true, claims };
  }
}

module.exports = new TokenService();
