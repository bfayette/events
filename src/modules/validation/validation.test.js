const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../../app');
const eventsService = require('../events/events.service');

describe('Anti-Replay Gate Verification Engine', () => {
  beforeEach(() => {
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
});
