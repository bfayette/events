const crypto = require('crypto');
const eventsService = require('../events/events.service');
const { hashPayload } = require('../events/events.service');

// Single-use lookup tokens store: token -> { ticketId, eventId, verifierLabel, expiresAt, used: boolean }
const lookupTokens = new Map();

/**
 * Mask name e.g. "John Doe" -> "J*** D***"
 */
function maskName(name) {
  if (!name || typeof name !== 'string') return null;
  const parts = name.trim().split(/\s+/);
  return parts
    .map(p => (p.length > 0 ? `${p[0]}${'*'.repeat(Math.min(3, Math.max(1, p.length - 1)))}.` : ''))
    .join(' ');
}

/**
 * Mask phone e.g. "+15145551234" -> "***-***-1234"
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const normalized = eventsService.normalizePhone(phone);
  if (!normalized) return null;
  const last4 = normalized.slice(-4);
  return `***-***-${last4}`;
}

/**
 * Normalizes text for accent-insensitive and case-insensitive matching
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Generates a 2-minute single-use lookupToken bound to verifierLabel and ticketId
 */
function createLookupToken({ ticketId, eventId, verifierLabel }) {
  const token = `lkt_${crypto.randomBytes(16).toString('hex')}`;
  const ttlMs = 2 * 60 * 1000; // 2 minutes
  lookupTokens.set(token, {
    token,
    ticketId,
    eventId,
    verifierLabel,
    expiresAt: Date.now() + ttlMs,
    used: false
  });
  return token;
}

/**
 * Validates and consumes a lookupToken for entry verification
 */
function consumeLookupToken({ lookupToken, verifierLabel }) {
  const record = lookupTokens.get(lookupToken);
  if (!record) {
    return { valid: false, reason: 'Invalid or unknown lookupToken' };
  }
  if (record.used) {
    return { valid: false, reason: 'lookupToken has already been consumed' };
  }
  if (Date.now() > record.expiresAt) {
    lookupTokens.delete(lookupToken);
    return { valid: false, reason: 'lookupToken has expired' };
  }
  if (record.verifierLabel !== verifierLabel) {
    return { valid: false, reason: 'lookupToken was issued to a different verifier' };
  }

  // Mark token used
  record.used = true;
  return { valid: true, ticketId: record.ticketId, eventId: record.eventId };
}

/**
 * Search candidates for gate staff lookup
 */
function searchCandidates({ eventId, phone, name, secondFactor, verifierLabel }) {
  if (!eventId) {
    return { status: 400, result: { message: 'eventId is required' } };
  }

  if (!phone && !name) {
    return { status: 400, result: { message: 'Either phone or name must be provided' } };
  }

  if (name) {
    const cleanName = normalizeText(name);
    if (cleanName.length < 3) {
      return { status: 400, result: { message: 'Name search query must be at least 3 characters long' } };
    }
    if (!secondFactor && !phone) {
      return {
        status: 400,
        result: { message: 'Name search requires a second factor (last 4 digits of phone, seat, section, or ticket reference)' }
      };
    }
  }

  // Scoped search within eventId
  const candidateTickets = [];
  const searchPhone = phone ? eventsService.normalizePhone(phone) : null;
  const searchNamePrefix = name ? normalizeText(name) : null;
  const secondFactorClean = secondFactor ? normalizeText(String(secondFactor)) : null;

  for (const rawTicket of eventsService.tickets.values()) {
    if (rawTicket.eventId !== eventId) continue;

    const tkt = eventsService.getTicketWithDefaults(rawTicket);

    // Anonymous tickets are excluded from lookup results
    if (tkt.holder_name === null && tkt.holder_phone === null && tkt.owner_email === null) {
      continue;
    }

    let match = false;

    // Direct phone match
    if (searchPhone && tkt.holder_phone === searchPhone) {
      match = true;
    }

    // Name match with second factor
    if (!match && searchNamePrefix && tkt.holder_name) {
      const ticketNameNorm = normalizeText(tkt.holder_name);
      if (ticketNameNorm.startsWith(searchNamePrefix)) {
        // Verify second factor
        if (secondFactorClean) {
          const seatMatch = tkt.seat && normalizeText(tkt.seat) === secondFactorClean;
          const sectionMatch = tkt.section && normalizeText(tkt.section) === secondFactorClean;
          const phoneLast4Match = tkt.holder_phone && tkt.holder_phone.endsWith(secondFactorClean);
          const ticketIdMatch = normalizeText(tkt.id).includes(secondFactorClean);

          if (seatMatch || sectionMatch || phoneLast4Match || ticketIdMatch) {
            match = true;
          }
        } else if (searchPhone && tkt.holder_phone === searchPhone) {
          match = true;
        }
      }
    }

    if (match) {
      candidateTickets.push(tkt);
      if (candidateTickets.length >= 5) break; // Return at most 5 candidates
    }
  }

  // Audit event log: action LOOKUP with hashed payload
  eventsService.logEvent({
    ticketId: candidateTickets.length === 1 ? candidateTickets[0].id : 'multiple',
    action: 'LOOKUP',
    actor: verifierLabel,
    payload: { queryHash: hashPayload({ eventId, phone: searchPhone, name: searchNamePrefix, secondFactor }) },
    method: 'LOOKUP',
    result: candidateTickets.length > 0 ? 'ACCEPTED' : 'NOT_FOUND'
  });

  const candidates = candidateTickets.map((tkt, idx) => {
    const rawTkt = Array.from(eventsService.tickets.values()).find(t => t.public_ref === tkt.public_ref) || tkt;
    const lookupToken = createLookupToken({
      ticketId: rawTkt.id || rawTkt.public_ref,
      eventId: tkt.eventId,
      verifierLabel
    });

    const entriesRemaining = Math.max(0, tkt.max_entries - tkt.entries_used);

    return {
      lookupToken,
      maskedName: maskName(tkt.holder_name || 'Anonymous'),
      maskedPhone: maskPhone(tkt.holder_phone),
      entriesRemaining,
      status: tkt.status,
      seat: tkt.seat,
      section: tkt.section
    };
  });

  return {
    status: 200,
    result: {
      eventId,
      count: candidates.length,
      candidates
    }
  };
}

module.exports = {
  maskName,
  maskPhone,
  createLookupToken,
  consumeLookupToken,
  searchCandidates
};
