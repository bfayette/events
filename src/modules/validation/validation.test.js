const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../../app');
const eventsService = require('../events/events.service');
const signerService = require('../passes/signer.service');

describe('Anti-Replay Gate Verification Engine & Offline Signed Receipts', () => {
  beforeEach(() => {
    signerService.resetRevocations();
    // Reset test ticket tkt_001
    eventsService.tickets.set('tkt_001', {
      id: 'tkt_001',
      eventId: 'evt_101',
      ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      secret: 'JBSWY3DPEHPK3PXP',
      seat: 'A-12',
      section: 'VIP',
      status: 'ISSUED'
    });
  });

  it('should successfully check in ticket with valid TOTP token', async () => {
    const validToken = authenticator.generate('JBSWY3DPEHPK3PXP');

    const res = await request(app)
      .post('/api/passes/verify')
      .send({
        ticketId: 'tkt_001',
        totpToken: validToken
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toEqual('Gate check-in successful');
    expect(res.body.status).toEqual('CHECKED_IN');

    // Verify ticket status in DB/store updated
    expect(eventsService.tickets.get('tkt_001').status).toEqual('CHECKED_IN');
  });

  it('should support combined scanned payload string e.g. "ticketId:totpToken"', async () => {
    eventsService.tickets.set('tkt_combined', {
      id: 'tkt_combined',
      eventId: 'evt_101',
      ownerAddress: '0x456',
      secret: 'JBSWY3DPEHPK3PXP',
      status: 'ISSUED'
    });

    const validToken = authenticator.generate('JBSWY3DPEHPK3PXP');

    const res = await request(app)
      .post('/api/passes/verify')
      .send({
        payload: `tkt_combined:${validToken}`
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('CHECKED_IN');
  });

  it('should return 409 Conflict when duplicate scan / replay attack occurs with same TOTP token', async () => {
    eventsService.tickets.set('tkt_replay', {
      id: 'tkt_replay',
      eventId: 'evt_101',
      ownerAddress: '0x123',
      secret: 'JBSWY3DPEHPK3PXP',
      status: 'ISSUED'
    });

    const validToken = authenticator.generate('JBSWY3DPEHPK3PXP');

    // First scan -> Success 200 (updates status to CHECKED_IN and caches token)
    const res1 = await request(app)
      .post('/api/passes/verify')
      .send({ ticketId: 'tkt_replay', totpToken: validToken });
    expect(res1.statusCode).toEqual(200);

    // Second scan with identical token -> Replay attack detected (409) even though status is CHECKED_IN
    const res2 = await request(app)
      .post('/api/passes/verify')
      .send({ ticketId: 'tkt_replay', totpToken: validToken });
    expect(res2.statusCode).toEqual(409);
    expect(res2.body.message).toContain('Replay attack detected');
  });

  it('should return 400 Bad Request for invalid TOTP token', async () => {
    const res = await request(app)
      .post('/api/passes/verify')
      .send({
        ticketId: 'tkt_001',
        totpToken: '000000'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Invalid or expired TOTP token');
  });

  describe('Signed Receipts (JWS & EIP-712) and Offline Reconciliation', () => {
    it('should issue JWS signed receipt containing minimal required claims', async () => {
      const res = await request(app)
        .post('/api/passes/issue-receipt')
        .send({
          ticketId: 'tkt_001',
          format: 'JWS',
          ttlSeconds: 120
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.receipt.format).toEqual('JWS');
      expect(res.body.receipt.claims).toHaveProperty('ticket_id', 'tkt_001');
      expect(res.body.receipt.claims).toHaveProperty('nonce');
      expect(res.body.receipt.claims).toHaveProperty('issued_at');
      expect(res.body.receipt.claims).toHaveProperty('expires_at');
      expect(res.body.receipt.claims).toHaveProperty('issuer');
      expect(res.body.receipt.claims).toHaveProperty('schema_version');
      expect(res.body.receipt.token).toBeDefined();
    });

    it('should issue EIP-712 signed receipt with structured typed data signature', async () => {
      const res = await request(app)
        .post('/api/passes/issue-receipt')
        .send({
          ticketId: 'tkt_001',
          format: 'EIP712',
          ttlSeconds: 60
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.receipt.format).toEqual('EIP712');
      expect(res.body.receipt.signature).toMatch(/^0x[a-f0-9]{64}$/);
      expect(res.body.receipt.message.ticket_id).toEqual('tkt_001');
    });

    it('should verify valid JWS receipt and block replay when scanned second time', async () => {
      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'tkt_001', format: 'JWS' });

      const receipt = receiptRes.body.receipt.token;

      // First verification -> 200
      const verify1 = await request(app)
        .post('/api/passes/verify-receipt')
        .send({ receipt });
      expect(verify1.statusCode).toEqual(200);
      expect(verify1.body.valid).toBe(true);

      // Replay verification -> 409
      const verify2 = await request(app)
        .post('/api/passes/verify-receipt')
        .send({ receipt });
      expect(verify2.statusCode).toEqual(409);
      expect(verify2.body.reason).toContain('Replay attack detected');
    });

    it('should reconcile offline receipts atomically and record audit events', async () => {
      eventsService.tickets.set('tkt_offline_1', {
        id: 'tkt_offline_1',
        eventId: 'evt_101',
        ownerAddress: '0xabc',
        secret: 'JBSWY3DPEHPK3PXP',
        status: 'ISSUED'
      });

      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'tkt_offline_1', format: 'JWS' });

      const receiptToken = receiptRes.body.receipt.token;

      const reconcileRes = await request(app)
        .post('/api/passes/reconcile')
        .send({
          verifierId: 'turnstile_gate_west',
          receipts: [receiptToken]
        });

      expect(reconcileRes.statusCode).toEqual(200);
      expect(reconcileRes.body.reconciledCount).toEqual(1);
      expect(reconcileRes.body.results[0].status).toEqual('ACCEPTED');

      // Verify DB state updated
      expect(eventsService.tickets.get('tkt_offline_1').status).toEqual('CHECKED_IN');

      // Verify audit log entry
      const ticketEvents = eventsService.getEventsForTicket('tkt_offline_1');
      expect(ticketEvents.some(e => e.action === 'CHECKIN_OFFLINE')).toBe(true);
    });

    it('should detect duplicate scan conflict during reconciliation', async () => {
      eventsService.tickets.set('tkt_conflict_1', {
        id: 'tkt_conflict_1',
        eventId: 'evt_101',
        ownerAddress: '0xdef',
        secret: 'JBSWY3DPEHPK3PXP',
        status: 'CHECKED_IN' // Already checked in online earlier
      });

      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'tkt_conflict_1', format: 'JWS' });

      const reconcileRes = await request(app)
        .post('/api/passes/reconcile')
        .send({
          verifierId: 'turnstile_gate_east',
          receipts: [receiptRes.body.receipt.token]
        });

      expect(reconcileRes.statusCode).toEqual(200);
      expect(reconcileRes.body.rejectedCount).toEqual(1);
      expect(reconcileRes.body.results[0].status).toEqual('REJECTED_CONFLICT');

      // Verify audit log captured conflict
      const ticketEvents = eventsService.getEventsForTicket('tkt_conflict_1');
      expect(ticketEvents.some(e => e.action === 'CHECKIN_CONFLICT')).toBe(true);
    });

    it('should reject receipt when operator key is revoked (compromise scenario)', async () => {
      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'tkt_001', format: 'JWS' });

      const receiptToken = receiptRes.body.receipt.token;

      // Simulate emergency operator key revocation
      signerService.revokeKey('op-key-2025-v1');

      const verifyRes = await request(app)
        .post('/api/passes/verify-receipt')
        .send({ receipt: receiptToken });

      expect(verifyRes.statusCode).toEqual(400);
      expect(verifyRes.body.valid).toBe(false);
      expect(verifyRes.body.reason).toContain('revoked');
    });
  });
});
