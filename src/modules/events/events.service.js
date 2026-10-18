const crypto = require('crypto');

// In-memory data store for events, tickets, venues, and loyalty programs

const events = new Map([
  [
    'evt_101',
    {
      id: 'evt_101',
      name: 'Crypto Tech Summit 2025',
      venue: 'Main Arena, San Francisco',
      date: '2025-09-15T18:00:00Z',
      capacity: 500
    }
  ]
]);

const tickets = new Map([
  [
    'tkt_001',
    {
      id: 'tkt_001',
      eventId: 'evt_101',
      owner_email: 'user@example.com',
      secret: 'JBSWY3DPEHPK3PXP', // Base32 secret for TOTP
      seat: 'A-12',
      section: 'VIP',
      status: 'ISSUED' // ISSUED, CHECKED_IN, TRANSFERRED, REDEEMED, REVOKED
    }
  ]
]);

const loyaltyAccounts = new Map([
  [
    'loy_001',
    {
      id: 'loy_001',
      owner_email: 'user@example.com',
      tier: 'Gold VIP',
      points: 1250,
      accountNumber: 'ACC-88991122'
    }
  ]
]);

// Append-only event audit log
const auditEventLog = [];

// Merkle anchors store
const merkleAnchors = new Map();

/**
 * Computes SHA-256 hash of arbitrary payload
 */
function hashPayload(payload) {
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Appends an immutable audit event record to the event log
 */
function logEvent({ ticketId, action, actor = 'system', payload = {}, statusTransition = null }) {
  const payloadHash = hashPayload(payload);
  const eventRecord = {
    id: `evt_log_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    ticketId,
    action,
    actor,
    payloadHash,
    statusTransition,
    anchorId: null,
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

/**
 * Retrieves unanchored events from the log
 */
function getUnanchoredEvents() {
  return auditEventLog.filter(e => e.anchorId === null);
}

/**
 * Marks events as anchored with an anchor ID
 */
function markEventsAnchored(eventIds, anchorId) {
  for (const eventRecord of auditEventLog) {
    if (eventIds.includes(eventRecord.id)) {
      eventRecord.anchorId = anchorId;
    }
  }
}

module.exports = {
  events,
  tickets,
  loyaltyAccounts,
  auditEventLog,
  merkleAnchors,
  logEvent,
  getEventsForTicket,
  getUnanchoredEvents,
  markEventsAnchored,
  hashPayload
};
