const request = require('supertest');
const app = require('../../app');
const eventsService = require('../events/events.service');
const { maskName, maskPhone } = require('./lookup.service');

describe('Phase E: Manual Lookup & Lookup Gate Verification', () => {
  beforeEach(() => {
    // Setup test tickets for evt_101
    eventsService.tickets.set('tkt_lookup_1', {
      id: 'tkt_lookup_1',
      eventId: 'evt_101',
      status: 'ISSUED',
      code_mode: 'TOTP',
      version: 1,
      max_entries: 1,
      entries_used: 0,
      holder_name: 'Marie Curie',
      holder_phone: '+15145551234',
      owner_email: 'marie@example.com',
      seat: 'Row-A-1'
    });

    eventsService.tickets.set('tkt_lookup_anon', {
      id: 'tkt_lookup_anon',
      eventId: 'evt_101',
      status: 'ISSUED',
      code_mode: 'TOTP',
      version: 1,
      max_entries: 1,
      entries_used: 0,
      holder_name: null,
      holder_phone: null,
      owner_email: null
    });
  });

  describe('PII Masking Utilities', () => {
    it('masks name and phone properly', () => {
      expect(maskName('Marie Curie')).toBe('M***. C***.');
      expect(maskPhone('+15145551234')).toBe('***-***-1234');
    });
  });

  describe('POST /api/lookup Search Endpoint', () => {
    it('finds holder by exact normalized phone number returning masked PII and single-use lookupToken', async () => {
      const res = await request(app)
        .post('/api/lookup')
        .send({
          eventId: 'evt_101',
          phone: '(514) 555-1234'
        });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      const candidate = res.body.candidates[0];
      expect(candidate.maskedName).toBe('M***. C***.');
      expect(candidate.maskedPhone).toBe('***-***-1234');
      expect(candidate.lookupToken).toBeDefined();
      expect(candidate).not.toHaveProperty('id');
      expect(candidate).not.toHaveProperty('owner_email');
    });

    it('requires a second factor when searching by holder name', async () => {
      // Bare name search -> 400 Bad Request
      const res1 = await request(app)
        .post('/api/lookup')
        .send({
          eventId: 'evt_101',
          name: 'Marie'
        });

      expect(res1.status).toBe(400);
      expect(res1.body.message).toMatch(/requires a second factor/);

      // Name + second factor (seat) -> 200 OK
      const res2 = await request(app)
        .post('/api/lookup')
        .send({
          eventId: 'evt_101',
          name: 'Marie',
          secondFactor: 'Row-A-1'
        });

      expect(res2.status).toBe(200);
      expect(res2.body.count).toBe(1);
    });

    it('excludes anonymous cash tickets from lookup results', async () => {
      const res = await request(app)
        .post('/api/lookup')
        .send({
          eventId: 'evt_101',
          phone: '+15145550000'
        });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });
  });

  describe('POST /api/passes/verify via LOOKUP method', () => {
    it('consumes entry using lookupToken and records idChecked flag in audit log', async () => {
      const lookupRes = await request(app)
        .post('/api/lookup')
        .send({
          eventId: 'evt_101',
          phone: '+15145551234'
        });

      const token = lookupRes.body.candidates[0].lookupToken;

      // Perform LOOKUP gate verification
      const verifyRes = await request(app)
        .post('/api/passes/verify')
        .send({
          method: 'LOOKUP',
          lookupToken: token,
          idChecked: true
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.status).toBe('CHECKED_IN');
      expect(verifyRes.body.idChecked).toBe(true);

      // Replay attempt with same lookupToken fails
      const replayRes = await request(app)
        .post('/api/passes/verify')
        .send({
          method: 'LOOKUP',
          lookupToken: token,
          idChecked: true
        });

      expect(replayRes.status).toBe(400);
      expect(replayRes.body.message).toContain('lookupToken has already been consumed');
    });
  });
});
