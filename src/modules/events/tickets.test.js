const request = require('supertest');
const app = require('../../app');
const eventsService = require('./events.service');
const { generateShortCode, normalizeShortCode, hashShortCode } = require('../passes/shortcode.service');

describe('Phase C: Short Codes & Ticket Issuance Endpoint', () => {
  beforeEach(() => {
    eventsService.events.set('evt_102', {
      id: 'evt_102',
      name: 'Static Ticket Event',
      venue: 'Auditorium',
      date: '2025-10-20T18:00:00Z',
      allowed_code_modes: ['TOTP', 'STATIC']
    });
  });

  describe('Crockford Short Code Generation & HMAC Hashing', () => {
    it('generates 8-character XXXX-XXXX formatted Crockford short code', () => {
      const code = generateShortCode();
      expect(code).toMatch(/^[0-9A-HJKMNPQRSTVWXYZ]{4}-[0-9A-HJKMNPQRSTVWXYZ]{4}$/);
      expect(code.length).toBe(9);
      expect(code[4]).toBe('-');
    });

    it('normalizes short code mapping O->0 and I/L->1 and ignoring spaces/hyphens', () => {
      expect(normalizeShortCode('  123O-IL  ')).toBe('123011');
      expect(normalizeShortCode('abcd-efgh')).toBe('ABCDEFGH');
    });

    it('produces deterministic HKDF HMAC-SHA256 hashes for short codes', () => {
      const hash1 = hashShortCode('evt_101', 'ABCD-EFGH');
      const hash2 = hashShortCode('evt_101', 'abcd-efgh');
      const hashDiffEvent = hashShortCode('evt_102', 'ABCD-EFGH');

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashDiffEvent);
      expect(hash1.length).toBe(64);
    });
  });

  describe('POST /api/tickets Endpoint', () => {
    it('returns 422 when attempting to issue STATIC ticket on event with allowed_code_modes=[TOTP]', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .send({
          eventId: 'evt_101',
          codeMode: 'STATIC',
          ownerEmail: 'alice@example.com'
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Code mode 'STATIC' is not allowed/);
    });

    it('issues STATIC ticket successfully returning qrPayload, shortCode, public_ref and holderToken', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .send({
          eventId: 'evt_102',
          codeMode: 'STATIC',
          holderName: 'Bob Builder',
          holderPhone: '+15145551234'
        });

      expect(res.status).toBe(201);
      expect(res.body.ticket).toBeDefined();
      expect(res.body.ticket.public_ref).toBeDefined();
      expect(res.body.ticket.id).toBeUndefined(); // Internal id omitted
      expect(res.body.ticket.code_mode).toBe('STATIC');
      expect(res.body.ticket.secret).toBeNull();
      expect(res.body.qrPayload).toBeDefined();
      expect(res.body.shortCode).toBeDefined();
      expect(res.body.holderToken).toBeDefined();

      const createdRef = res.body.ticket.public_ref;
      const storedTicket = eventsService.getTicketByPublicRef(createdRef);
      expect(storedTicket).toBeDefined();
      expect(storedTicket.secret).toBeNull();
      expect(storedTicket.short_code_hash).toBeDefined();
      expect(storedTicket.short_code_hash).not.toBe(res.body.shortCode);

      const auditEvents = eventsService.getEventsForTicket(storedTicket.id);
      expect(auditEvents.length).toBeGreaterThan(0);
      const auditPayloadStr = JSON.stringify(auditEvents[0]);
      expect(auditPayloadStr).not.toContain(res.body.shortCode);
    });

    it('issues TOTP ticket successfully returning wallet URLs with public_ref and holderToken', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .send({
          eventId: 'evt_101',
          codeMode: 'TOTP',
          ownerEmail: 'charlie@example.com'
        });

      expect(res.status).toBe(201);
      expect(res.body.ticket.public_ref).toBeDefined();
      expect(res.body.ticket.id).toBeUndefined();
      expect(res.body.ticket.code_mode).toBe('TOTP');
      expect(res.body.ticket.secret).toBeDefined();
      expect(res.body.holderToken).toBeDefined();
      expect(res.body.applePassUrl).toContain(`/api/tickets/${res.body.ticket.public_ref}/apple-pass`);
      expect(res.body.googlePassUrl).toContain(`/api/tickets/${res.body.ticket.public_ref}/google-pass-url`);
    });

    it('rejects ticket creation when no contact info is provided and anonymous is false', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .send({
          eventId: 'evt_101',
          codeMode: 'TOTP'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/At least one of holder_name, holder_phone, or owner_email must be present/);
    });
  });
});
