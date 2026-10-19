const request = require('supertest');
const app = require('../../app');
const eventsService = require('./events.service');
const signerService = require('../passes/signer.service');
const { hashShortCode } = require('../passes/shortcode.service');

describe('Phase F: Ticket Reissue & Recovery Flow', () => {
  beforeEach(() => {
    eventsService.events.set('evt_reissue_100', {
      id: 'evt_reissue_100',
      name: 'Reissue Test Event',
      date: '2025-12-01T18:00:00Z',
      allowed_code_modes: ['TOTP', 'STATIC']
    });
  });

  it('reissues ticket, bumps version and reissue_count, and generates new QR & short code while preserving entries_used', async () => {
    const issueRes = await request(app)
      .post('/api/tickets')
      .send({
        eventId: 'evt_reissue_100',
        codeMode: 'STATIC',
        holderName: 'Alice Springs',
        holderPhone: '+15145558888',
        maxEntries: 2
      });

    const ticketRef = issueRes.body.ticket.public_ref;
    const oldQrPayload = issueRes.body.qrPayload;
    const oldShortCode = issueRes.body.shortCode;

    const tktRecord = eventsService.getTicketByPublicRef(ticketRef);
    tktRecord.entries_used = 1;

    const reissueRes = await request(app)
      .post(`/api/tickets/${ticketRef}/reissue`)
      .send({
        recoveryMethod: 'phone_lookup'
      });

    expect(reissueRes.status).toBe(200);
    expect(reissueRes.body.ticket.version).toBe(2);
    expect(reissueRes.body.ticket.reissue_count).toBe(1);
    expect(reissueRes.body.ticket.entries_used).toBe(1);
    expect(reissueRes.body.qrPayload).not.toBe(oldQrPayload);
    expect(reissueRes.body.shortCode).not.toBe(oldShortCode);
    expect(reissueRes.body.holderToken).toBeDefined();

    const scanOldQr = await request(app)
      .post('/api/passes/verify')
      .send({
        method: 'STATIC_QR',
        payload: oldQrPayload,
        eventId: 'evt_reissue_100'
      });

    expect(scanOldQr.status).toBe(400);
    expect(scanOldQr.body.code).toBe('DENIED_SUPERSEDED');

    const scanOldShort = await request(app)
      .post('/api/passes/verify')
      .send({
        method: 'SHORT_CODE',
        code: oldShortCode,
        eventId: 'evt_reissue_100'
      });

    expect(scanOldShort.status).toBe(400);
    expect(scanOldShort.body.code).toBe('DENIED_INVALID');
  });

  it('refuses reissue on fully used ticket unless admin_override', async () => {
    eventsService.tickets.set('tkt_used_up', {
      id: 'tkt_used_up',
      public_ref: 'ref_used_up',
      eventId: 'evt_reissue_100',
      status: 'CHECKED_IN',
      code_mode: 'STATIC',
      version: 1,
      max_entries: 1,
      entries_used: 1,
      owner_email: 'used@example.com'
    });

    const resNormal = await request(app)
      .post('/api/tickets/ref_used_up/reissue')
      .send({
        recoveryMethod: 'id_check'
      });

    expect(resNormal.status).toBe(400);
    expect(resNormal.body.message).toContain('fully used or revoked');

    const resNoNote = await request(app)
      .post('/api/tickets/ref_used_up/reissue')
      .send({
        recoveryMethod: 'admin_override'
      });

    expect(resNoNote.status).toBe(400);
    expect(resNoNote.body.message).toContain('non-empty note');

    const resWithNote = await request(app)
      .post('/api/tickets/ref_used_up/reissue')
      .send({
        recoveryMethod: 'admin_override',
        note: 'Customer lost printout at entrance gate'
      });

    expect(resWithNote.status).toBe(200);
    expect(resWithNote.body.ticket.version).toBe(2);
  });

  it('enforces maximum reissue cap (3 reissues) unless admin_override', async () => {
    eventsService.tickets.set('tkt_capped', {
      id: 'tkt_capped',
      public_ref: 'ref_capped',
      eventId: 'evt_reissue_100',
      status: 'ISSUED',
      code_mode: 'STATIC',
      version: 3,
      reissue_count: 3,
      max_entries: 1,
      entries_used: 0,
      owner_email: 'capped@example.com'
    });

    const resCapped = await request(app)
      .post('/api/tickets/ref_capped/reissue')
      .send({
        recoveryMethod: 'phone_lookup'
      });

    expect(resCapped.status).toBe(400);
    expect(resCapped.body.message).toContain('maximum reissue cap');
  });
});
