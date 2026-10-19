const request = require('supertest');
const { loadConfig } = require('../../config');
const app = require('../../app');
const eventsService = require('../events/events.service');

describe('Phase A: Auth & Role-Based Access Control', () => {
  const validKeyAdmin = 'a_very_long_admin_key_32_characters_123456';
  const validKeyVerifier101 = 'a_very_long_verifier_key_32_chars_101';
  const validKeySales = 'a_very_long_sales_key_32_characters_1234';

  const testApiKeys = JSON.stringify({
    [validKeyAdmin]: { role: 'admin', label: 'Admin Key' },
    [validKeyVerifier101]: { role: 'verifier', eventIds: ['evt_101'], label: 'Verifier 101' },
    [validKeySales]: { role: 'sales', label: 'Sales Counter' }
  });

  describe('Config Validation for API_KEYS and AUTH_ENFORCED', () => {
    const baseProdEnv = {
      NODE_ENV: 'production',
      PORT: '3000',
      OPERATOR_KEY_ID: 'op-key-prod-1',
      OPERATOR_SECRET: 'a_very_long_production_operator_secret_1234567890_32chars',
      GOOGLE_WALLET_SECRET: 'a_very_long_production_google_wallet_secret_1234567890_32chars'
    };

    it('fails production boot if API_KEYS is missing when AUTH_ENFORCED=true', () => {
      expect(() => loadConfig({ ...baseProdEnv, AUTH_ENFORCED: 'true' })).toThrow(/API_KEYS is required in production/);
    });

    it('fails boot if an API key is shorter than 32 characters', () => {
      const shortKeyMap = JSON.stringify({
        short_key: { role: 'admin', label: 'Short Key' }
      });
      expect(() => loadConfig({ ...baseProdEnv, API_KEYS: shortKeyMap })).toThrow(/must be at least 32 characters long/);
    });

    it('fails boot if an API key has an invalid role', () => {
      const invalidRoleMap = JSON.stringify({
        [validKeyAdmin]: { role: 'super_hero', label: 'Super Hero' }
      });
      expect(() => loadConfig({ ...baseProdEnv, API_KEYS: invalidRoleMap })).toThrow(/must have role 'sales', 'verifier', 'agent', or 'admin'/);
    });
  });

  describe('Middleware Access Control (AUTH_ENFORCED behavior)', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env;
      jest.resetModules();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns 401 when missing key in auth-enforced request', async () => {
      process.env.AUTH_ENFORCED = 'true';
      process.env.API_KEYS = testApiKeys;
      process.env.OPERATOR_SECRET = 'a_very_long_operator_secret_32chars_long';
      process.env.GOOGLE_WALLET_SECRET = 'a_very_long_google_secret_32chars_long';

      let isolatedApp;
      jest.isolateModules(() => {
        isolatedApp = require('../../app');
      });

      const res = await request(isolatedApp)
        .post('/api/passes/verify')
        .send({ ticketId: 'tkt_001', totpToken: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Authentication key is required/);
    });

    it('returns 401 for invalid API key', async () => {
      process.env.AUTH_ENFORCED = 'true';
      process.env.API_KEYS = testApiKeys;
      process.env.OPERATOR_SECRET = 'a_very_long_operator_secret_32chars_long';
      process.env.GOOGLE_WALLET_SECRET = 'a_very_long_google_secret_32chars_long';

      let isolatedApp;
      jest.isolateModules(() => {
        isolatedApp = require('../../app');
      });

      const res = await request(isolatedApp)
        .post('/api/passes/verify')
        .set('Authorization', 'Bearer invalid_key_that_is_32_characters_long_123')
        .send({ ticketId: 'tkt_001', totpToken: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Invalid API key/);
    });

    it('returns 403 when user role is not permitted for the endpoint', async () => {
      process.env.AUTH_ENFORCED = 'true';
      process.env.API_KEYS = testApiKeys;
      process.env.OPERATOR_SECRET = 'a_very_long_operator_secret_32chars_long';
      process.env.GOOGLE_WALLET_SECRET = 'a_very_long_google_secret_32chars_long';

      let isolatedApp;
      jest.isolateModules(() => {
        isolatedApp = require('../../app');
      });

      // 'sales' role cannot access /api/passes/verify (requires 'verifier')
      const res = await request(isolatedApp)
        .post('/api/passes/verify')
        .set('Authorization', `Bearer ${validKeySales}`)
        .send({ ticketId: 'tkt_001', totpToken: '123456' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden: Insufficient permissions/);
    });

    it('returns 403 when verifier attempts to access an event outside their eventIds scope', async () => {
      process.env.AUTH_ENFORCED = 'true';
      process.env.API_KEYS = testApiKeys;
      process.env.OPERATOR_SECRET = 'a_very_long_operator_secret_32chars_long';
      process.env.GOOGLE_WALLET_SECRET = 'a_very_long_google_secret_32chars_long';

      let isolatedApp;
      let isolatedEventsService;
      jest.isolateModules(() => {
        isolatedApp = require('../../app');
        isolatedEventsService = require('../events/events.service');
      });

      // Set up a ticket for event evt_999
      isolatedEventsService.tickets.set('tkt_999', {
        id: 'tkt_999',
        eventId: 'evt_999',
        owner_email: 'test@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        status: 'ISSUED'
      });

      const res = await request(isolatedApp)
        .post('/api/passes/verify')
        .set('Authorization', `Bearer ${validKeyVerifier101}`)
        .send({ ticketId: 'tkt_999', totpToken: '123456' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied for event evt_999/);
    });
  });
});
