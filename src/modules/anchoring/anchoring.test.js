const request = require('supertest');
const app = require('../../app');
const eventsService = require('../events/events.service');
const anchoringService = require('./anchoring.service');

describe('Merkle Event Log Anchoring Worker', () => {
  beforeEach(() => {
    // Log dummy audit events
    eventsService.logEvent({
      ticketId: 'tkt_anchor_1',
      action: 'ISSUE',
      actor: 'admin',
      payload: { ticketId: 'tkt_anchor_1' },
      statusTransition: 'NONE -> ISSUED'
    });
    eventsService.logEvent({
      ticketId: 'tkt_anchor_1',
      action: 'CHECKIN',
      actor: 'gate_1',
      payload: { ticketId: 'tkt_anchor_1' },
      statusTransition: 'ISSUED -> CHECKED_IN'
    });
  });

  it('should compute canonical Merkle root for array of hashes', () => {
    const hashes = ['a1b2c3', 'd4e5f6', '7890ab'];
    const root = anchoringService.computeMerkleRoot(hashes);
    expect(root).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should batch unanchored event hashes into a Merkle root and post anchor transaction', async () => {
    const unanchoredBefore = eventsService.getUnanchoredEvents();
    expect(unanchoredBefore.length).toBeGreaterThan(0);

    const res = await request(app)
      .post('/api/anchoring/anchor')
      .send({ chainId: 137, operator: 'cron_anchoring_worker' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.anchored).toBe(true);
    expect(res.body.merkleRoot).toMatch(/^0x[a-f0-9]{64}$/);
    expect(res.body.txHash).toMatch(/^0x[a-f0-9]{64}$/);

    // Verify unanchored count is now zero (or only contains the new ANCHOR audit event)
    const unanchoredAfter = eventsService.getUnanchoredEvents().filter(e => e.action !== 'ANCHOR');
    expect(unanchoredAfter.length).toEqual(0);
  });

  it('should list all Merkle anchor batches', async () => {
    // Ensure at least one anchor exists
    anchoringService.anchorPendingEvents({ chainId: 137 });

    const res = await request(app).get('/api/anchoring/anchors');
    expect(res.statusCode).toEqual(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.anchors)).toBe(true);
  });
});
