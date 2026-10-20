const request = require('supertest');
const app = require('./app');
const eventsService = require('./modules/events/events.service');
const tokenService = require('./modules/passes/token.service');
const rateLimiter = require('./modules/rateLimiter');
const { config } = require('./config');

describe('PR #13 Hardening Gaps Verification', () => {
  let eventA, eventB, ticketA, ticketB, revokedTicket;
  let keyScopedA, keyScopedB, verifierKey, adminKey;
  let holderTokenA, downloadTokenA;

  beforeAll(() => {
    // Reset rate limiter before starting
    rateLimiter.reset();

    // Create demo events
    eventA = 'evt_hardening_A';
    eventB = 'evt_hardening_B';

    eventsService.events.set(eventA, { id: eventA, name: 'Event A', allowed_code_modes: ['TOTP', 'STATIC'] });
    eventsService.events.set(eventB, { id: eventB, name: 'Event B', allowed_code_modes: ['TOTP', 'STATIC'] });

    // Create tickets
    const pubRefA = 'pub_ref_hardening_A_1234567890';
    const pubRefB = 'pub_ref_hardening_B_1234567890';
    const pubRefRev = 'pub_ref_hardening_REV_1234567890';

    ticketA = {
      id: 'tkt_a_1',
      public_ref: pubRefA,
      eventId: eventA,
      status: 'ISSUED',
      version: 1,
      max_entries: 1,
      entries_used: 0,
      code_mode: 'TOTP',
      secret: 'JBSWY3DPEHPK3PXP'
    };

    ticketB = {
      id: 'tkt_b_1',
      public_ref: pubRefB,
      eventId: eventB,
      status: 'ISSUED',
      version: 1,
      max_entries: 1,
      entries_used: 0,
      code_mode: 'TOTP',
      secret: 'JBSWY3DPEHPK3PXP'
    };

    revokedTicket = {
      id: 'tkt_rev_1',
      public_ref: pubRefRev,
      eventId: eventA,
      status: 'REVOKED',
      version: 1,
      max_entries: 1,
      entries_used: 0,
      code_mode: 'TOTP',
      secret: 'JBSWY3DPEHPK3PXP'
    };

    eventsService.tickets.set(ticketA.id, ticketA);
    eventsService.tickets.set(ticketB.id, ticketB);
    eventsService.tickets.set(revokedTicket.id, revokedTicket);

    // Set up API keys in config
    keyScopedA = 'api_key_scoped_event_a_1234567890_32chars';
    keyScopedB = 'api_key_scoped_event_b_1234567890_32chars';
    verifierKey = 'api_key_verifier_role_1234567890_32chars';
    adminKey = 'api_key_admin_role_1234567890_32chars';

    config.apiKeys[keyScopedA] = { role: 'sales', label: 'Scoped Sales A', eventIds: [eventA] };
    config.apiKeys[keyScopedB] = { role: 'sales', label: 'Scoped Sales B', eventIds: [eventB] };
    config.apiKeys[verifierKey] = { role: 'verifier', label: 'Verifier Terminal', eventIds: [eventA, eventB] };
    config.apiKeys[adminKey] = { role: 'admin', label: 'Global Admin' };

    holderTokenA = tokenService.generateHolderToken({ publicRef: pubRefA, version: 1 });
    downloadTokenA = tokenService.generateDownloadToken({ publicRef: pubRefA, version: 1 });
  });

  beforeEach(() => {
    rateLimiter.reset();
  });

  describe('Gap 1: Event Scope & Allowed Roles Enforcement', () => {
    it('returns 403 when staff key scoped to Event B tries to access Event A pass routes', async () => {
      const resApple = await request(app)
        .get(`/api/tickets/${ticketA.public_ref}/apple-pass`)
        .set('Authorization', `Bearer ${keyScopedB}`);
      expect(resApple.statusCode).toBe(403);

      const resGoogle = await request(app)
        .get(`/api/tickets/${ticketA.public_ref}/google-pass-url`)
        .set('Authorization', `Bearer ${keyScopedB}`);
      expect(resGoogle.statusCode).toBe(403);
    });

    it('returns 403 when staff key scoped to Event B tries to call /tokens or /download-token on Event A ticket', async () => {
      const resTokens = await request(app)
        .post(`/api/tickets/${ticketA.public_ref}/tokens`)
        .set('Authorization', `Bearer ${keyScopedB}`);
      expect(resTokens.statusCode).toBe(403);

      const resDl = await request(app)
        .post(`/api/tickets/${ticketA.public_ref}/download-token`)
        .set('Authorization', `Bearer ${keyScopedB}`);
      expect(resDl.statusCode).toBe(403);
    });

    it('returns 403 when verifier key tries to access pass routes or mint download tokens', async () => {
      const resPass = await request(app)
        .get(`/api/tickets/${ticketA.public_ref}/apple-pass`)
        .set('Authorization', `Bearer ${verifierKey}`);
      expect(resPass.statusCode).toBe(403);

      const resDl = await request(app)
        .post(`/api/tickets/${ticketA.public_ref}/download-token`)
        .set('Authorization', `Bearer ${verifierKey}`);
      expect(resDl.statusCode).toBe(403);
    });

    it('returns 200 when staff key scoped to Event A accesses Event A pass route or token routes', async () => {
      const resGoogle = await request(app)
        .get(`/api/tickets/${ticketA.public_ref}/google-pass-url`)
        .set('Authorization', `Bearer ${keyScopedA}`);
      expect(resGoogle.statusCode).toBe(200);

      const resTokens = await request(app)
        .post(`/api/tickets/${ticketA.public_ref}/tokens`)
        .set('Authorization', `Bearer ${keyScopedA}`);
      expect(resTokens.statusCode).toBe(200);
      expect(resTokens.body.holderToken).toBeDefined();
    });
  });

  describe('Gap 2: Query-String Credentials & Security Headers', () => {
    it('returns 401 when a 7-day holder token is passed in ?token= query parameter', async () => {
      const res = await request(app).get(`/api/tickets/${ticketA.public_ref}/apple-pass?token=${holderTokenA}`);
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when a staff API key is passed in ?token= query parameter', async () => {
      const res = await request(app).get(`/api/tickets/${ticketA.public_ref}/apple-pass?token=${adminKey}`);
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 when a valid 5-minute download token is passed in ?token= query parameter', async () => {
      const res = await request(app).get(`/api/tickets/${ticketA.public_ref}/google-pass-url?token=${downloadTokenA}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.saveUrl).toBeDefined();
    });

    it('sets Cache-Control: no-store and Referrer-Policy: no-referrer on pass responses', async () => {
      const res = await request(app).get(`/api/tickets/${ticketA.public_ref}/google-pass-url?token=${downloadTokenA}`);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });
  });

  describe('Gap 3: Holder Token Refresh Prohibited & Revoked Tickets Denied', () => {
    it('returns 401 when a holder token calls POST /api/tickets/:public_ref/tokens', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketA.public_ref}/tokens`)
        .set('Authorization', `Bearer ${holderTokenA}`);
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 (TICKET_REVOKED) for revoked ticket pass downloads and token minting', async () => {
      const resApple = await request(app)
        .get(`/api/tickets/${revokedTicket.public_ref}/apple-pass`)
        .set('Authorization', `Bearer ${adminKey}`);
      expect(resApple.statusCode).toBe(403);
      expect(resApple.body.code).toBe('TICKET_REVOKED');

      const resTokens = await request(app)
        .post(`/api/tickets/${revokedTicket.public_ref}/tokens`)
        .set('Authorization', `Bearer ${adminKey}`);
      expect(resTokens.statusCode).toBe(403);
      expect(resTokens.body.code).toBe('TICKET_REVOKED');

      const resDl = await request(app)
        .post(`/api/tickets/${revokedTicket.public_ref}/download-token`)
        .set('Authorization', `Bearer ${adminKey}`);
      expect(resDl.statusCode).toBe(403);
      expect(resDl.body.code).toBe('TICKET_REVOKED');
    });
  });

  describe('Gap 5: Rate Limiting Enforcement', () => {
    it('returns 429 with Retry-After header when failure limit is exceeded', async () => {
      // Execute 10 failed requests to exceed failure limit (config limit = 10)
      for (let i = 0; i < 10; i++) {
        await request(app).get(`/api/tickets/non_existent_ref/apple-pass`).set('Authorization', `Bearer ${adminKey}`);
      }

      // The 11th request must be rate-limited with HTTP 429
      const res = await request(app).get(`/api/tickets/${ticketA.public_ref}/google-pass-url`).set('Authorization', `Bearer ${adminKey}`);
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('rate-limits short-code scan path after consecutive failures', async () => {
      // Execute failed short-code scans
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/passes/verify')
          .set('Authorization', `Bearer ${verifierKey}`)
          .send({ method: 'SHORT_CODE', eventId: eventA, code: 'WRONG123' });
      }

      const res = await request(app)
        .post('/api/passes/verify')
        .set('Authorization', `Bearer ${verifierKey}`)
        .send({ method: 'SHORT_CODE', eventId: eventA, code: 'WRONG123' });

      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });
  });
});
