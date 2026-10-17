const request = require('supertest');
const app = require('../../app');
const eventsService = require('../events/events.service');

describe('ERC-4337 Gasless Account Abstraction Intent Routing', () => {
  beforeEach(() => {
    // Reset test ticket and loyalty records
    eventsService.tickets.set('tkt_001', {
      id: 'tkt_001',
      eventId: 'evt_101',
      ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      secret: 'JBSWY3DPEHPK3PXP',
      seat: 'A-12',
      section: 'VIP',
      status: 'ISSUED'
    });

    eventsService.loyaltyAccounts.set('loy_001', {
      id: 'loy_001',
      ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      tier: 'Gold VIP',
      points: 1250,
      accountNumber: 'ACC-88991122'
    });
  });

  describe('POST /api/aa/transfer-ticket', () => {
    it('should construct ERC-4337 UserOperation for ticket transfer', async () => {
      const res = await request(app)
        .post('/api/aa/transfer-ticket')
        .send({
          ticketId: 'tkt_001',
          recipientAddress: '0x9999999999999999999999999999999999999999'
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.userOp).toBeDefined();
      expect(res.body.userOp.sender).toEqual('0x1234567890abcdef1234567890abcdef12345678');
      expect(res.body.userOp.callData).toContain('_transferTicket_tkt_001_to_0x9999999999999999999999999999999999999999');
      expect(res.body.userOp.paymasterAndData).toBeDefined();
    });

    it('should return 404 for unknown ticket', async () => {
      const res = await request(app)
        .post('/api/aa/transfer-ticket')
        .send({
          ticketId: 'tkt_missing',
          recipientAddress: '0x999'
        });

      expect(res.statusCode).toEqual(404);
    });
  });

  describe('POST /api/aa/redeem-points', () => {
    it('should construct ERC-4337 UserOperation for loyalty redemption', async () => {
      const res = await request(app)
        .post('/api/aa/redeem-points')
        .send({
          loyaltyId: 'loy_001',
          points: 500,
          rewardId: 'reward_vip_lounge_access'
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.userOp).toBeDefined();
      expect(res.body.userOp.callData).toContain('_redeemPoints_loy_001_500_reward_reward_vip_lounge_access');
    });

    it('should return 400 for insufficient points', async () => {
      const res = await request(app)
        .post('/api/aa/redeem-points')
        .send({
          loyaltyId: 'loy_001',
          points: 5000
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toContain('Insufficient loyalty points balance');
    });
  });

  describe('POST /api/aa/dispatch', () => {
    it('should accept signed UserOp and process dispatch via Paymaster', async () => {
      const transferRes = await request(app)
        .post('/api/aa/transfer-ticket')
        .send({
          ticketId: 'tkt_001',
          recipientAddress: '0x9999999999999999999999999999999999999999'
        });

      const userOp = transferRes.body.userOp;

      const dispatchRes = await request(app)
        .post('/api/aa/dispatch')
        .send({
          userOp,
          signature: '0x_webauthn_passkey_p256_stamped_signature'
        });

      expect(dispatchRes.statusCode).toEqual(200);
      expect(dispatchRes.body.result.status).toEqual('SUBMITTED');
      expect(dispatchRes.body.result.paymasterSponsored).toBe(true);

      // Verify ticket state updated to TRANSFERRED
      const updatedTicket = eventsService.tickets.get('tkt_001');
      expect(updatedTicket.ownerAddress).toEqual('0x9999999999999999999999999999999999999999');
      expect(updatedTicket.status).toEqual('TRANSFERRED');
    });
  });
});
