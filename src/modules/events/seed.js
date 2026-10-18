// Demo fixtures for development and test environments only.
// This file is never loaded in production.

const demoEvents = [
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
];

// Demo fixture ticket with fixed TOTP secret JBSWY3DPEHPK3PXP.
// This is purely a fixture for local testing/development and is never loaded in production.
const demoTickets = [
  [
    'tkt_001',
    {
      id: 'tkt_001',
      eventId: 'evt_101',
      owner_email: 'buyer@example.com',
      secret: 'JBSWY3DPEHPK3PXP', // Base32 secret for demo TOTP verification
      seat: 'A-12',
      section: 'VIP',
      status: 'ISSUED' // ISSUED, CHECKED_IN, TRANSFERRED, REDEEMED, REVOKED
    }
  ]
];

const demoLoyaltyAccounts = [
  [
    'loy_001',
    {
      id: 'loy_001',
      owner_email: 'buyer@example.com',
      tier: 'Gold VIP',
      points: 1250,
      accountNumber: 'ACC-88991122'
    }
  ]
];

/**
 * Seeds the provided Map data structures with demo data fixtures.
 * @param {Map} eventsMap
 * @param {Map} ticketsMap
 * @param {Map} loyaltyAccountsMap
 */
function seedDemoData(eventsMap, ticketsMap, loyaltyAccountsMap) {
  for (const [id, event] of demoEvents) {
    eventsMap.set(id, { ...event });
  }
  for (const [id, ticket] of demoTickets) {
    ticketsMap.set(id, { ...ticket });
  }
  for (const [id, loyalty] of demoLoyaltyAccounts) {
    loyaltyAccountsMap.set(id, { ...loyalty });
  }
}

module.exports = {
  demoEvents,
  demoTickets,
  demoLoyaltyAccounts,
  seedDemoData
};
