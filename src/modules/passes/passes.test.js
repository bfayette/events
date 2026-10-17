const request = require('supertest');
const JSZip = require('jszip');
const jwt = require('jsonwebtoken');
const app = require('../../app');

describe('Pass Generation Engine & Endpoints', () => {
  describe('GET /api/tickets/:id/apple-pass', () => {
    it('should return a valid .pkpass zip file buffer with pass.json and manifest.json', async () => {
      const res = await request(app)
        .get('/api/tickets/tkt_001/apple-pass')
        .responseType('blob');

      expect(res.statusCode).toEqual(200);
      expect(res.headers['content-type']).toEqual('application/vnd.apple.pkpass');

      // Parse zip buffer
      const zip = await JSZip.loadAsync(res.body);
      expect(zip.file('pass.json')).not.toBeNull();
      expect(zip.file('manifest.json')).not.toBeNull();
      expect(zip.file('signature')).not.toBeNull();

      const passJsonText = await zip.file('pass.json').async('string');
      const passJson = JSON.parse(passJsonText);

      expect(passJson.formatVersion).toEqual(1);
      expect(passJson.serialNumber).toEqual('tkt_001');
      expect(passJson.eventTicket).toBeDefined();
      expect(passJson.barcode.message).toMatch(/^tkt_001:\d{6}$/); // ticketId:totp
    });

    it('should return 404 for unknown ticket', async () => {
      const res = await request(app).get('/api/tickets/tkt_unknown/apple-pass');
      expect(res.statusCode).toEqual(404);
    });
  });

  describe('GET /api/tickets/:id/google-pass-url', () => {
    it('should return Google Wallet save URL and claims object with TOTP barcode', async () => {
      const res = await request(app).get('/api/tickets/tkt_001/google-pass-url');

      expect(res.statusCode).toEqual(200);
      expect(res.body.saveUrl).toContain('https://pay.google.com/gp/v/save/');
      expect(res.body.claims).toBeDefined();

      const token = res.body.saveUrl.replace('https://pay.google.com/gp/v/save/', '');
      const decoded = jwt.decode(token);

      expect(decoded.payload.eventTicketObjects[0].barcode.value).toMatch(/^tkt_001:\d{6}$/);
    });
  });

  describe('GET /api/loyalty/:id/apple-pass and /google-pass-url', () => {
    it('should return Apple .pkpass for loyalty account', async () => {
      const res = await request(app)
        .get('/api/loyalty/loy_001/apple-pass')
        .responseType('blob');

      expect(res.statusCode).toEqual(200);
      expect(res.headers['content-type']).toEqual('application/vnd.apple.pkpass');
    });

    it('should return Google Wallet save URL for loyalty account', async () => {
      const res = await request(app).get('/api/loyalty/loy_001/google-pass-url');
      expect(res.statusCode).toEqual(200);
      expect(res.body.claims.payload.loyaltyObjects[0].loyaltyPoints.balance.string).toEqual('1250');
    });
  });
});
