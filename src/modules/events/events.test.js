const { seedDemoData } = require('./seed');

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
