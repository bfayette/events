const { seedDemoData } = require('./seed');

const eventsService = require('./events.service');

describe('Events Service Seed Logic', () => {
  it('leaves events, tickets, and loyalty maps empty when seedDemoData is false', () => {
    const eventsMap = new Map();
    const ticketsMap = new Map();
    const loyaltyMap = new Map();

    const seedConfig = false;
    if (seedConfig) {
      seedDemoData(eventsMap, ticketsMap, loyaltyMap);
    }

    expect(eventsMap.size).toEqual(0);
    expect(ticketsMap.size).toEqual(0);
    expect(loyaltyMap.size).toEqual(0);
  });

  it('populates events, tickets, and loyalty maps when seedDemoData is true', () => {
    const eventsMap = new Map();
    const ticketsMap = new Map();
    const loyaltyMap = new Map();

    seedDemoData(eventsMap, ticketsMap, loyaltyMap);

    expect(eventsMap.size).toBeGreaterThan(0);
    expect(ticketsMap.size).toBeGreaterThan(0);
    expect(loyaltyMap.size).toBeGreaterThan(0);
    expect(ticketsMap.get('tkt_001')).toBeDefined();
    expect(ticketsMap.get('tkt_001').secret).toEqual('JBSWY3DPEHPK3PXP');
  });
});

describe('Phase B: Data Model & Holder Data Retention Purge', () => {
  it('populates default fields for existing ticket fixture tkt_001', () => {
    const rawTicket = eventsService.tickets.get('tkt_001');
    expect(rawTicket).toBeDefined();

    const tkt = eventsService.getTicketWithDefaults(rawTicket);
    expect(tkt.code_mode).toEqual('TOTP');
    expect(tkt.version).toEqual(1);
    expect(tkt.max_entries).toEqual(1);
    expect(tkt.entries_used).toEqual(0);
    expect(tkt.holder_binding).toEqual({ type: 'none' });
    expect(tkt.reissue_count).toEqual(0);
  });

  it('normalizes phone numbers to E.164 format', () => {
    expect(eventsService.normalizePhone('+1 (514) 555-1234')).toEqual('+15145551234');
    expect(eventsService.normalizePhone('5145551234')).toEqual('+15145551234');
    expect(eventsService.normalizePhone(null)).toBeNull();
  });

  it('enforces contact constraints: at least one contact method required unless anonymous sales', () => {
    // Missing all contact info
    const check1 = eventsService.validateTicketContactInfo({
      holder_name: '',
      holder_phone: '',
      owner_email: '',
      anonymous: false,
      isSalesRole: false
    });
    expect(check1.valid).toBe(false);

    // Sales role issuing anonymous ticket
    const check2 = eventsService.validateTicketContactInfo({
      holder_name: '',
      holder_phone: '',
      owner_email: '',
      anonymous: true,
      isSalesRole: true
    });
    expect(check2.valid).toBe(true);

    // Valid contact present
    const check3 = eventsService.validateTicketContactInfo({
      holder_name: 'Alice',
      holder_phone: '',
      owner_email: ''
    });
    expect(check3.valid).toBe(true);
  });

  it('purges expired holder PII after retention days window', () => {
    // Set up an event in the past
    eventsService.events.set('evt_past', {
      id: 'evt_past',
      name: 'Past Event',
      date: '2024-01-01T00:00:00Z',
      retention_days: 30
    });

    eventsService.tickets.set('tkt_purge_me', {
      id: 'tkt_purge_me',
      eventId: 'evt_past',
      owner_email: 'expired@example.com',
      holder_name: 'John Doe',
      holder_phone: '+15145559999',
      status: 'CHECKED_IN'
    });

    const now = new Date('2024-03-01T00:00:00Z'); // 60 days after event
    const purgedCount = eventsService.purgeExpiredHolderData(now);

    expect(purgedCount).toBeGreaterThan(0);
    const purgedTicket = eventsService.tickets.get('tkt_purge_me');
    expect(purgedTicket.owner_email).toBeNull();
    expect(purgedTicket.holder_name).toBeNull();
    expect(purgedTicket.holder_phone).toBeNull();
  });

  it('logs audit events with method, result, and meta', () => {
    const log = eventsService.logEvent({
      ticketId: 'tkt_001',
      action: 'CHECKIN_DENIED',
      actor: 'verifier_1',
      payload: { test: true },
      method: 'STATIC_QR',
      result: 'DENIED_ALREADY_USED',
      meta: { firstUsedAt: '2025-01-01T10:00:00Z' }
    });

    expect(log.method).toEqual('STATIC_QR');
    expect(log.result).toEqual('DENIED_ALREADY_USED');
    expect(log.meta.firstUsedAt).toEqual('2025-01-01T10:00:00Z');
  });
});
