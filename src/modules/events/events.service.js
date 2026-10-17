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
      ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      secret: 'JBSWY3DPEHPK3PXP', // Base32 secret for TOTP
      seat: 'A-12',
      section: 'VIP',
      status: 'ISSUED' // ISSUED, CHECKED_IN, TRANSFERRED
    }
  ]
]);

const loyaltyAccounts = new Map([
  [
    'loy_001',
    {
      id: 'loy_001',
      ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      tier: 'Gold VIP',
      points: 1250,
      accountNumber: 'ACC-88991122'
    }
  ]
]);

module.exports = {
  events,
  tickets,
  loyaltyAccounts
};
