const request = require('supertest');
const app = require('../../app');

describe('Turnkey Sub-Org Provisioning & Stamp Proxy Engine', () => {
  describe('POST /api/users/provision-wallet', () => {
    it('should provision a Turnkey sub-organization and store wallet address without raw keys', async () => {
      const res = await request(app)
        .post('/api/users/provision-wallet')
        .send({
          userId: 'user_alice_99',
          subOrgName: 'Alice SubOrg',
          passkeyName: 'Alice iPhone Passkey'
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.userId).toEqual('user_alice_99');
      expect(res.body.user.subOrganizationId).toMatch(/^suborg-/);
      expect(res.body.user.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

      // Verify zero custody: ensure no privateKey or seedPhrase properties exist
      expect(res.body.user.privateKey).toBeUndefined();
      expect(res.body.user.seedPhrase).toBeUndefined();
    });

    it('should return 400 if userId is missing', async () => {
      const res = await request(app)
        .post('/api/users/provision-wallet')
        .send({});

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toEqual('userId is required');
    });

    it('should fetch provisioned wallet info via GET /api/users/:userId/wallet', async () => {
      await request(app)
        .post('/api/users/provision-wallet')
        .send({ userId: 'user_bob_88' });

      const res = await request(app).get('/api/users/user_bob_88/wallet');
      expect(res.statusCode).toEqual(200);
      expect(res.body.userId).toEqual('user_bob_88');
    });
  });

  describe('POST /api/turnkey/proxy', () => {
    it('should relay client-stamped requests without parsing or altering signature payload', async () => {
      const res = await request(app)
        .post('/api/turnkey/proxy')
        .set('X-Stamp', 'mock_client_signature_stamp_12345')
        .send({
          type: 'ACTIVITY_TYPE_CREATE_READ_ONLY_SESSION',
          organizationId: 'suborg-123'
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.relayed).toBe(true);
      expect(res.body.stampHeaderPresent).toBe(true);
    });
  });
});
