const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../../app');
const eventsService = require('../events/events.service');
const signerService = require('../passes/signer.service');

describe('Anti-Replay Gate Verification Engine & Offline Signed Receipts', () => {
  beforeEach(() => {
    signerService.resetRevocations();
    eventsService.tickets.set('tkt_001', {
      id: 'tkt_001',
      public_ref: 'ref_demo_tkt_001_seed_2025',
      eventId: 'evt_101',
      owner_email: 'buyer@example.com',
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
        ticketId: 'ref_demo_tkt_001_seed_2025',
        totpToken: validToken
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toEqual('Gate check-in successful');
    expect(res.body.status).toEqual('CHECKED_IN');

    expect(eventsService.tickets.get('tkt_001').status).toEqual('CHECKED_IN');
  });

  it('should support combined scanned payload string e.g. "publicRef:totpToken"', async () => {
    eventsService.tickets.set('tkt_combined', {
      id: 'tkt_combined',
      public_ref: 'ref_combined_123',
      eventId: 'evt_101',
      owner_email: 'buyer2@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      status: 'ISSUED'
    });

    const validToken = authenticator.generate('JBSWY3DPEHPK3PXP');

    const res = await request(app)
      .post('/api/passes/verify')
      .send({
        payload: `ref_combined_123:${validToken}`
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('CHECKED_IN');
  });

  it('should return 409 Conflict when duplicate scan / replay attack occurs with same TOTP token', async () => {
    eventsService.tickets.set('tkt_replay', {
      id: 'tkt_replay',
      public_ref: 'ref_replay_123',
      eventId: 'evt_101',
      owner_email: 'buyer3@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      status: 'ISSUED'
    });

    const validToken = authenticator.generate('JBSWY3DPEHPK3PXP');

    const res1 = await request(app)
      .post('/api/passes/verify')
      .send({ ticketId: 'ref_replay_123', totpToken: validToken });
    expect(res1.statusCode).toEqual(200);

    const res2 = await request(app)
      .post('/api/passes/verify')
      .send({ ticketId: 'ref_replay_123', totpToken: validToken });
    expect(res2.statusCode).toEqual(409);
    expect(res2.body.message).toContain('Replay attack detected');
  });

  it('should return 400 Bad Request for invalid TOTP token', async () => {
    const res = await request(app)
      .post('/api/passes/verify')
      .send({
        ticketId: 'ref_demo_tkt_001_seed_2025',
        totpToken: '000000'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Invalid or expired TOTP token');
  });

  describe('Signed Receipts and Offline Reconciliation', () => {
    it('should issue JWS signed receipt containing minimal required claims', async () => {
      const res = await request(app)
        .post('/api/passes/issue-receipt')
        .send({
          ticketId: 'ref_demo_tkt_001_seed_2025',
          format: 'JWS',
          ttlSeconds: 120
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.receipt.format).toEqual('JWS');
      expect(res.body.receipt.claims).toHaveProperty('ticket_id', 'ref_demo_tkt_001_seed_2025');
      expect(res.body.receipt.claims).toHaveProperty('nonce');
      expect(res.body.receipt.claims).toHaveProperty('issued_at');
      expect(res.body.receipt.claims).toHaveProperty('expires_at');
      expect(res.body.receipt.claims).toHaveProperty('issuer');
      expect(res.body.receipt.claims).toHaveProperty('schema_version');
      expect(res.body.receipt.token).toBeDefined();
    });

    it('should return 400 when unsupported receipt format is requested on /issue-receipt', async () => {
      const res = await request(app)
        .post('/api/passes/issue-receipt')
        .send({
          ticketId: 'ref_demo_tkt_001_seed_2025',
          format: 'UNSUPPORTED_FORMAT',
          ttlSeconds: 60
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toEqual("Unsupported receipt format. Only 'JWS' is supported");
    });

    it('should return 400 when an unsupported receipt payload object is submitted to /verify-receipt', async () => {
      const res = await request(app)
        .post('/api/passes/verify-receipt')
        .send({
          receipt: {
            format: 'UNSUPPORTED_FORMAT',
            message: { ticket_id: 'ref_demo_tkt_001_seed_2025' },
            signature: '0x123'
          }
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toEqual('Unsupported or missing receipt payload format');
    });

    it('should verify valid JWS receipt and block replay when scanned second time', async () => {
      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'ref_demo_tkt_001_seed_2025', format: 'JWS' });

      const receipt = receiptRes.body.receipt.token;

      const verify1 = await request(app)
        .post('/api/passes/verify-receipt')
        .send({ receipt });
      expect(verify1.statusCode).toEqual(200);
      expect(verify1.body.valid).toBe(true);

      const verify2 = await request(app)
        .post('/api/passes/verify-receipt')
        .send({ receipt });
      expect(verify2.statusCode).toEqual(409);
      expect(verify2.body.reason).toContain('Replay attack detected');
    });

    it('should reconcile offline receipts atomically and record audit events', async () => {
      eventsService.tickets.set('tkt_offline_1', {
        id: 'tkt_offline_1',
        public_ref: 'ref_offline_1',
        eventId: 'evt_101',
        owner_email: 'buyer_offline@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        status: 'ISSUED'
      });

      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'ref_offline_1', format: 'JWS' });

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

      expect(eventsService.tickets.get('tkt_offline_1').status).toEqual('CHECKED_IN');

      const ticketEvents = eventsService.getEventsForTicket('tkt_offline_1');
      expect(ticketEvents.some(e => e.action === 'CHECKIN_OFFLINE')).toBe(true);
    });

    it('should detect duplicate scan conflict during reconciliation', async () => {
      eventsService.tickets.set('tkt_conflict_1', {
        id: 'tkt_conflict_1',
        public_ref: 'ref_conflict_1',
        eventId: 'evt_101',
        owner_email: 'buyer_conflict@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        status: 'CHECKED_IN'
      });

      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'ref_conflict_1', format: 'JWS' });

      const reconcileRes = await request(app)
        .post('/api/passes/reconcile')
        .send({
          verifierId: 'turnstile_gate_east',
          receipts: [receiptRes.body.receipt.token]
        });

      expect(reconcileRes.statusCode).toEqual(200);
      expect(reconcileRes.body.rejectedCount).toEqual(1);
      expect(reconcileRes.body.results[0].status).toEqual('REJECTED_CONFLICT');

      const ticketEvents = eventsService.getEventsForTicket('tkt_conflict_1');
      expect(ticketEvents.some(e => e.action === 'CHECKIN_CONFLICT')).toBe(true);
    });

    it('should reject receipt when operator key is revoked (compromise scenario)', async () => {
      const receiptRes = await request(app)
        .post('/api/passes/issue-receipt')
        .send({ ticketId: 'ref_demo_tkt_001_seed_2025', format: 'JWS' });

      const receiptToken = receiptRes.body.receipt.token;

      signerService.revokeKey(receiptRes.body.receipt.kid);

      const verifyRes = await request(app)
        .post('/api/passes/verify-receipt')
        .send({ receipt: receiptToken });

      expect(verifyRes.statusCode).toEqual(400);
      expect(verifyRes.body.valid).toBe(false);
      expect(verifyRes.body.reason).toContain('revoked');
    });
  });

  describe('Phase D: Gate Verification Methods, Multi-Entry, & Rate Limiting', () => {
    it('photocopy test: scanning same static QR code twice gives ACCEPTED then DENIED_ALREADY_USED with previous entry details', async () => {
      const staticTokenObj = signerService.generateStaticCode({
        ticketId: 'ref_static_qr_1',
        version: 1,
        eventId: 'evt_101'
      });

      eventsService.tickets.set('tkt_static_qr_1', {
        id: 'tkt_static_qr_1',
        public_ref: 'ref_static_qr_1',
        eventId: 'evt_101',
        status: 'ISSUED',
        code_mode: 'STATIC',
        version: 1,
        max_entries: 1,
        entries_used: 0,
        owner_email: 'paper@example.com'
      });

      const scan1 = await request(app)
        .post('/api/passes/verify')
        .send({
          method: 'STATIC_QR',
          payload: staticTokenObj.qrPayload,
          eventId: 'evt_101'
        });

      expect(scan1.statusCode).toBe(200);
      expect(scan1.body.status).toBe('CHECKED_IN');
      expect(scan1.body.entriesUsed).toBe(1);

      const scan2 = await request(app)
        .post('/api/passes/verify')
        .send({
          method: 'STATIC_QR',
          payload: staticTokenObj.qrPayload,
          eventId: 'evt_101'
        });

      expect(scan2.statusCode).toBe(400);
      expect(scan2.body.code).toBe('DENIED_ALREADY_USED');
      expect(scan2.body.previousEntry).toBeDefined();
      expect(scan2.body.previousEntry.timestamp).toBeDefined();
      expect(scan2.body.previousEntry.method).toBe('STATIC_QR');
    });

    it('group pass: max_entries=4 accepts 4 entries and denies the 5th scan', async () => {
      const validToken = authenticator.generate('JBSWY3DPEHPK3PXP');

      eventsService.tickets.set('tkt_group_4', {
        id: 'tkt_group_4',
        public_ref: 'ref_group_4',
        eventId: 'evt_101',
        secret: 'JBSWY3DPEHPK3PXP',
        status: 'ISSUED',
        code_mode: 'TOTP',
        version: 1,
        max_entries: 4,
        entries_used: 0,
        owner_email: 'family@example.com'
      });

      for (let i = 1; i <= 4; i++) {
        const res = await request(app)
          .post('/api/passes/verify')
          .send({ ticketId: 'ref_group_4', totpToken: validToken });

        expect(res.statusCode).toBe(200);
        expect(res.body.entriesUsed).toBe(i);
        expect(res.body.maxEntries).toBe(4);
        if (i < 4) {
          expect(res.body.status).toBe('ISSUED');
        } else {
          expect(res.body.status).toBe('CHECKED_IN');
        }
      }

      const res5 = await request(app)
        .post('/api/passes/verify')
        .send({ ticketId: 'ref_group_4', totpToken: validToken });

      expect(res5.statusCode).toBe(400);
      expect(res5.body.code).toBe('DENIED_ALREADY_USED');
    });

    it('superseded QR test: reissued static ticket with old version gives DENIED_SUPERSEDED', async () => {
      const oldStaticToken = signerService.generateStaticCode({
        ticketId: 'ref_reissued_1',
        version: 1,
        eventId: 'evt_101'
      });

      eventsService.tickets.set('tkt_reissued_1', {
        id: 'tkt_reissued_1',
        public_ref: 'ref_reissued_1',
        eventId: 'evt_101',
        status: 'ISSUED',
        code_mode: 'STATIC',
        version: 2,
        max_entries: 1,
        entries_used: 0,
        owner_email: 'reissued@example.com'
      });

      const res = await request(app)
        .post('/api/passes/verify')
        .send({
          method: 'STATIC_QR',
          payload: oldStaticToken.qrPayload,
          eventId: 'evt_101'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('DENIED_SUPERSEDED');
      expect(res.body.message).toContain('reissued and code is superseded');
    });

    it('short code rate limiting: triggers 429 RATE_LIMITED after 5 failed short code attempts', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/passes/verify')
          .send({
            method: 'SHORT_CODE',
            code: 'INVALID0',
            eventId: 'evt_101'
          });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('DENIED_INVALID');
      }

      const resRateLimited = await request(app)
        .post('/api/passes/verify')
        .send({
          method: 'SHORT_CODE',
          code: 'INVALID0',
          eventId: 'evt_101'
        });

      expect(resRateLimited.statusCode).toBe(429);
      expect(resRateLimited.body.code).toBe('RATE_LIMITED');
    });
  });
});
