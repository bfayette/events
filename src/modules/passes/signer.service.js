const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class SignerService {
  constructor() {
    // Default operator KMS secret and active Key ID
    this.activeKeyId = process.env.OPERATOR_KEY_ID || 'op-key-2025-v1';
    this.keys = new Map([
      ['op-key-2025-v1', process.env.OPERATOR_SECRET || 'kms-operator-secret-2025-key-v1'],
      ['op-key-2025-v2', 'kms-operator-secret-2025-key-v2-backup']
    ]);
    // Dynamic Key Revocation List (KRL)
    this.revokedKeys = new Set();
  }

  /**
   * Revoke an operator key ID in emergency scenario
   */
  revokeKey(kid) {
    this.revokedKeys.add(kid);
  }

  /**
   * Un-revoke or reset revoked keys (for testing)
   */
  resetRevocations() {
    this.revokedKeys.clear();
  }

  /**
   * Rotate active operator key
   */
  rotateKey(newKid, secret) {
    if (secret) {
      this.keys.set(newKid, secret);
    }
    this.activeKeyId = newKid;
  }

  /**
   * Generates a signed JWS receipt for offline/online scanning
   */
  generateJWSReceipt({ ticketId, ttlSeconds = 60, issuer = 'urn:events:operator:main', schemaVersion = '1.0' }) {
    const now = Math.floor(Date.now() / 1000);
    const kid = this.activeKeyId;
    const secret = this.keys.get(kid);

    if (this.revokedKeys.has(kid)) {
      throw new Error(`Cannot sign receipt: Operator key ${kid} is revoked`);
    }

    const payload = {
      ticket_id: ticketId,
      issued_at: now,
      expires_at: now + ttlSeconds,
      nonce: crypto.randomUUID(),
      issuer,
      schema_version: schemaVersion
    };

    const token = jwt.sign(payload, secret, {
      algorithm: 'HS256',
      header: { kid, typ: 'JWT' }
    });

    const resolverUrl = `/api/tickets/${ticketId}/resolver?receipt=${encodeURIComponent(token)}`;

    return {
      token,
      format: 'JWS',
      kid,
      claims: payload,
      qrPayload: token,
      resolverUrl
    };
  }

  /**
   * Verifies a JWS receipt token
   */
  verifyJWSReceipt(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'Missing or malformed token' };
    }

    let decodedHeader;
    try {
      decodedHeader = jwt.decode(token, { complete: true })?.header;
    } catch {
      return { valid: false, reason: 'Invalid JWS token structure' };
    }

    if (!decodedHeader || !decodedHeader.kid) {
      return { valid: false, reason: 'JWS header missing key ID (kid)' };
    }

    const kid = decodedHeader.kid;

    // 1. Check Key Revocation List
    if (this.revokedKeys.has(kid)) {
      return { valid: false, reason: `Operator key ${kid} has been revoked` };
    }

    // 2. Retrieve key secret
    const secret = this.keys.get(kid);
    if (!secret) {
      return { valid: false, reason: `Unknown operator key ID ${kid}` };
    }

    // 3. Verify signature
    let claims;
    try {
      claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return { valid: false, reason: 'Signed receipt has expired' };
      }
      return { valid: false, reason: 'Signature verification failed' };
    }

    // 4. Verify minimal required claims
    const requiredClaims = ['ticket_id', 'issued_at', 'expires_at', 'nonce', 'issuer', 'schema_version'];
    for (const claim of requiredClaims) {
      if (claims[claim] === undefined || claims[claim] === null) {
        return { valid: false, reason: `Missing required claim: ${claim}` };
      }
    }

    // 5. Verify TTL expiration
    const now = Math.floor(Date.now() / 1000);
    const clockSkewSeconds = 15;
    if (now > claims.expires_at) {
      return { valid: false, reason: 'Signed receipt has expired (expires_at check)' };
    }
    if (now < claims.issued_at - clockSkewSeconds) {
      return { valid: false, reason: 'Signed receipt timestamp is in the future' };
    }

    return { valid: true, claims, kid };
  }
}

module.exports = new SignerService();
