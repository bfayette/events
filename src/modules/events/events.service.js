const crypto = require('crypto');
const { config } = require('../../config');
const { seedDemoData } = require('./seed');

// In-memory data store for events, tickets, venues, and loyalty programs
const events = new Map();
const tickets = new Map();
const loyaltyAccounts = new Map();

if (config.seedDemoData) {
  seedDemoData(events, tickets, loyaltyAccounts);
}

// Append-only event audit log
const auditEventLog = [];

/**
 * Computes SHA-256 hash of arbitrary payload
 */
function hashPayload(payload) {
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Normalizes phone number to E.164 string format.
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return `+${digits}`;
}

/**
 * Ensures ticket object returns standard default field values.
 */
function getTicketWithDefaults(ticket) {
  if (!ticket) return null;
  return {
    id: ticket.id,
    eventId: ticket.eventId,
    owner_email: ticket.owner_email ?? null,
    secret: ticket.secret ?? null,
    seat: ticket.seat ?? null,
    section: ticket.section ?? null,
    status: ticket.status || 'ISSUED',
    code_mode: ticket.code_mode || 'TOTP',
    version: ticket.version !== undefined ? ticket.version : 1,
    max_entries: ticket.max_entries !== undefined ? ticket.max_entries : 1,
    entries_used: ticket.entries_used !== undefined ? ticket.entries_used : 0,
    holder_name: ticket.holder_name ?? null,
    holder_phone: ticket.holder_phone ? normalizePhone(ticket.holder_phone) : null,
    holder_binding: ticket.holder_binding || { type: 'none' },
    short_code_hash: ticket.short_code_hash ?? null,
    reissue_count: ticket.reissue_count !== undefined ? ticket.reissue_count : 0,
    checkedInAt: ticket.checkedInAt ?? null,
    metadata: ticket.metadata || {}
  };
}

/**
 * Ensures event object returns standard default field values.
 */
function getEventWithDefaults(event) {
  if (!event) return null;
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    date: event.date,
    capacity: event.capacity,
    allowed_code_modes: event.allowed_code_modes || ['TOTP'],
    retention_days: event.retention_days !== undefined ? event.retention_days : (config.holderDataRetentionDays || 30)
  };
}

/**
 * Validates ticket contact constraints.
 * At least one of holder_name, holder_phone, or owner_email must be present
 * unless sales role sets anonymous: true.
 */
function validateTicketContactInfo({ holder_name, holder_phone, owner_email, anonymous, isSalesRole }) {
  const hasContact = Boolean(
    (holder_name && String(holder_name).trim()) ||
    (holder_phone && String(holder_phone).trim()) ||
    (owner_email && String(owner_email).trim())
  );

  if (!hasContact) {
    if (isSalesRole && anonymous === true) {
      return { valid: true, anonymous: true };
    }
    return {
      valid: false,
      reason: 'At least one of holder_name, holder_phone, or owner_email must be present unless issued as anonymous by sales'
    };
  }

  return { valid: true, anonymous: false };
}

/**
 * Purges expired holder PII (holder_name, holder_phone, owner_email) for events past retention window.
 */
function purgeExpiredHolderData(now = new Date()) {
  let purgedCount = 0;
  const nowMs = now.getTime();

  for (const rawEvent of events.values()) {
    const event = getEventWithDefaults(rawEvent);
    const eventEndDate = new Date(event.date || 0);
    const retentionDays = event.retention_days || 30;
    const purgeThresholdMs = eventEndDate.getTime() + (retentionDays * 24 * 60 * 60 * 1000);

    if (nowMs > purgeThresholdMs) {
      for (const ticket of tickets.values()) {
        if (ticket.eventId === event.id) {
          let modified = false;
          if (ticket.holder_name !== null && ticket.holder_name !== undefined) {
            ticket.holder_name = null;
            modified = true;
          }
          if (ticket.holder_phone !== null && ticket.holder_phone !== undefined) {
            ticket.holder_phone = null;
            modified = true;
          }
          if (ticket.owner_email !== null && ticket.owner_email !== undefined) {
            ticket.owner_email = null;
            modified = true;
          }
          if (modified) {
            purgedCount++;
          }
        }
      }
    }
  }

  return purgedCount;
}

/**
 * Appends an immutable audit event record to the event log
 */
function logEvent({
  ticketId,
  action,
  actor = 'system',
  payload = {},
  statusTransition = null,
  method = null,
  result = null,
  meta = null
}) {
  const payloadHash = hashPayload(payload);
  const eventRecord = {
    id: `evt_log_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    ticketId,
    action,
    actor,
    payloadHash,
    statusTransition,
    method,
    result,
    meta: meta || {},
    createdAt: new Date().toISOString()
  };
  auditEventLog.push(eventRecord);
  return eventRecord;
}

/**
 * Retrieves all audit log events for a given ticket
 */
function getEventsForTicket(ticketId) {
  return auditEventLog.filter(e => e.ticketId === ticketId);
}

module.exports = {
  events,
  tickets,
  loyaltyAccounts,
  auditEventLog,
  logEvent,
  getEventsForTicket,
  hashPayload,
  normalizePhone,
  getTicketWithDefaults,
  getEventWithDefaults,
  validateTicketContactInfo,
  purgeExpiredHolderData
};
