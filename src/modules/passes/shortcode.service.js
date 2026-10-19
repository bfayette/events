const crypto = require('crypto');
const { config } = require('../../config');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates an 8-character Crockford base32 short code formatted as XXXX-XXXX.
 */
function generateShortCode() {
  let chars = '';
  for (let i = 0; i < 8; i++) {
    const idx = crypto.randomInt(0, ALPHABET.length);
    chars += ALPHABET[idx];
  }
  return `${chars.substring(0, 4)}-${chars.substring(4)}`;
}

/**
 * Normalizes a short code string:
 * Uppercases, strips hyphens & whitespace, maps O -> 0 and I/L -> 1.
 */
function normalizeShortCode(code) {
  if (!code || typeof code !== 'string') return '';
  return code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/**
 * Computes HMAC-SHA256 hash for a short code bound to an event ID.
 * Uses HKDF(operatorSecret, "short-code") as key.
 */
function hashShortCode(eventId, rawCode) {
  const normalized = normalizeShortCode(rawCode);
  if (!normalized) return '';

  const ikm = config.operatorSecret;
  const hkdfKey = crypto.hkdfSync('sha256', ikm, '', 'short-code', 32);
  const data = `${eventId}:${normalized}`;

  return crypto.createHmac('sha256', hkdfKey).update(data).digest('hex');
}

module.exports = {
  generateShortCode,
  normalizeShortCode,
  hashShortCode
};
