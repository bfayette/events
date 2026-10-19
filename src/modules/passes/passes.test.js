const request = require('supertest');
const JSZip = require('jszip');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const eventsService = require('../events/events.service');
const tokenService = require('./token.service');

describe('Pass Generation Engine & Endpoints (Hardened)', () => {
  const seededPublicRef = 'ref_demo_tkt_001_seed_2025';

  let holderToken;
  let downloadToken;

  beforeEach(() => {
    // Generate valid holder and download tokens for demo ticket
    holderToken = tokenService.generateHolderToken({
      publicRef: seededPublicRef,
      version: 1,
      holderIdentifier: 'buyer@example.com'
    });

    downloadToken = tokenService.generateDownloadToken({
      publicRef: seededPublicRef,
      version: 1
    });
  });

  describe('Pass Authentication & Access Control', () => {
    it('should return 401 for request with no credentials', async () => {
      const res = await request(app).get(`/api/tickets/${seededPublicRef}/apple-pass`);
      expect(res.statusCode).toEqual(401);
      expect(res.body.message).toContain('Authentication required');
    });

    it('should return 404 for legacy tkt_... ID on public pass routes', async () => {
      const res = await request(app)
        .get('/api/tickets/tkt_001/apple-pass')
        .query({ token: holderToken });
      expect(res.statusCode).toEqual(404);
      expect(res.body.message).toEqual('Ticket not found');
    });

    it('should enforce token isolation: token for ticket A cannot fetch ticket B', async () => {
      // Create ticket B
      const ticketB = {
        id: 'tkt_isolation_b',
        public_ref: 'ref_ticket_b_isolation',
        eventId: 'evt_101',
        owner_email: 'other@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        status: 'ISSUED',
        version: 1
      };
      eventsService.tickets.set('tkt_isolation_b', ticketB);

      // Attempt to fetch ticket B pass using ticket A holderToken
      const res = await request(app)
        .get('/api/tickets/ref_ticket_b_isolation/apple-pass')
        .set('Authorization', `Bearer ${holderToken}`);

      expect(res.statusCode).toEqual(401);
      expect(res.body.message).toContain('mismatch');
    });

    it('should invalidate holder token after ticket reissue (version mismatch)', async () => {
      // Reissue tkt_001 (bumps version to 2)
      const tkt = eventsService.tickets.get('tkt_001');
      tkt.version = 2;

      // Old v1 holderToken attempt
      const res = await request(app)
        .get(`/api/tickets/${seededPublicRef}/apple-pass`)
        .set('Authorization', `Bearer ${holderToken}`);

      expect(res.statusCode).toEqual(401);
      expect(res.body.message).toContain('version mismatch');

      // Reset version for other tests
      tkt.version = 1;
    });
  });

  describe('GET /api/tickets/:public_ref/apple-pass', () => {
    it('should return .pkpass file when authenticated with holderToken in header', async () => {
      const res = await request(app)
        .get(`/api/tickets/${seededPublicRef}/apple-pass`)
        .set('Authorization', `Bearer ${holderToken}`)
        .responseType('blob');

      expect(res.statusCode).toEqual(200);
      expect(res.headers['content-type']).toEqual('application/vnd.apple.pkpass');

      const zip = await JSZip.loadAsync(res.body);
      expect(zip.file('pass.json')).not.toBeNull();

      const passJson = JSON.parse(await zip.file('pass.json').async('string'));
      expect(passJson.serialNumber).toEqual(seededPublicRef);
      expect(passJson.barcode.message).toMatch(new RegExp(`^${seededPublicRef}:\\d{6}$`));
    });

    it('should return .pkpass file when authenticated with downloadToken query param', async () => {
      const res = await request(app)
        .get(`/api/tickets/${seededPublicRef}/apple-pass`)
        .query({ token: downloadToken })
        .responseType('blob');

      expect(res.statusCode).toEqual(200);
      expect(res.headers['content-type']).toEqual('application/vnd.apple.pkpass');
    });
  });

  describe('GET /api/tickets/:public_ref/google-pass-url', () => {
    it('should return Google Wallet save URL and claims with public_ref barcode', async () => {
      const res = await request(app)
        .get(`/api/tickets/${seededPublicRef}/google-pass-url`)
        .set('Authorization', `Bearer ${holderToken}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.saveUrl).toContain('https://pay.google.com/gp/v/save/');

      const saveToken = res.body.saveUrl.replace('https://pay.google.com/gp/v/save/', '');
      const decoded = jwt.decode(saveToken);

      expect(decoded.payload.eventTicketObjects[0].barcode.value).toMatch(new RegExp(`^${seededPublicRef}:\\d{6}$`));
    });
  });

  describe('POST /api/tickets/:public_ref/download-token', () => {
    it('should generate a 5-minute download token when authenticated with holder token', async () => {
      const res = await request(app)
        .post(`/api/tickets/${seededPublicRef}/download-token`)
        .set('Authorization', `Bearer ${holderToken}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.downloadToken).toBeDefined();
      expect(res.body.expiresIn).toEqual(300);

      // Verify returned download token works for apple pass download
      const passRes = await request(app)
        .get(`/api/tickets/${seededPublicRef}/apple-pass`)
        .query({ token: res.body.downloadToken })
        .responseType('blob');

      expect(passRes.statusCode).toEqual(200);
    });
  });

  describe('Removed Loyalty Pass Routes', () => {
    it('should return 404 for removed loyalty pass routes', async () => {
      const res1 = await request(app).get('/api/loyalty/loy_001/apple-pass');
      expect(res1.statusCode).toEqual(404);

      const res2 = await request(app).get('/api/loyalty/loy_001/google-pass-url');
      expect(res2.statusCode).toEqual(404);
    });
  });
});
