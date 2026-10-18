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
  hashPayload
};
