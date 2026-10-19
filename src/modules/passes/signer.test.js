const signerService = require('./signer.service');
const jwt = require('jsonwebtoken');

describe('SignerService Key Rotation & Unknown Kid Handling', () => {
  beforeEach(() => {
    signerService.resetRevocations();
  });

  it('verifies a receipt signed with a previous key after rotation, but signs new receipts with the active key', () => {
    const prevKid = 'op-key-old';
    const prevSecret = 'a_very_long_previous_secret_1234567890_32chars';
    signerService.keys.set(prevKid, prevSecret);

    // Sign a token manually with the previous key
    const prevToken = jwt.sign(
      {
        ticket_id: 'tkt_prev',
        issued_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 60,
        nonce: 'nonce-123',
        issuer: 'urn:events:operator:main',
        schema_version: '1.0'
      },
      prevSecret,
      { algorithm: 'HS256', header: { kid: prevKid, typ: 'JWT' } }
    );

    // Verify token signed with previous key succeeds
    const verifyPrev = signerService.verifyJWSReceipt(prevToken);
    expect(verifyPrev.valid).toBe(true);
    expect(verifyPrev.kid).toEqual(prevKid);

    // Rotate active key
    const newKid = 'op-key-new';
    const newSecret = 'a_very_long_new_active_secret_1234567890_32chars';
    signerService.rotateKey(newKid, newSecret);

    // Generate new receipt -> signed with active key (newKid)
    const newReceipt = signerService.generateJWSReceipt({ ticketId: 'tkt_new' });
    expect(newReceipt.kid).toEqual(newKid);

    // The token signed with previous key still verifies after rotation
    const verifyPrevAfterRotation = signerService.verifyJWSReceipt(prevToken);
    expect(verifyPrevAfterRotation.valid).toBe(true);
  });

  it('rejects a receipt with an unknown kid', () => {
    const unknownToken = jwt.sign(
      {
        ticket_id: 'tkt_unknown',
        issued_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 60,
        nonce: 'nonce-456',
        issuer: 'urn:events:operator:main',
        schema_version: '1.0'
      },
      'some_secret_1234567890_32chars',
      { algorithm: 'HS256', header: { kid: 'unknown-kid-xyz', typ: 'JWT' } }
    );

    const result = signerService.verifyJWSReceipt(unknownToken);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unknown operator key ID unknown-kid-xyz');
  });
});

describe('Static Ticket Codes & Cross-Use Security Checks', () => {
  beforeEach(() => {
    signerService.resetRevocations();
  });

  it('generates and verifies valid static ticket code JWS', () => {
    const staticCode = signerService.generateStaticCode({
      ticketId: 'tkt_static_100',
      version: 2,
      eventId: 'evt_101'
    });

    expect(staticCode.token).toBeDefined();
    expect(staticCode.claims.use).toBe('static_ticket');
    expect(staticCode.claims.v).toBe(2);

    const verifyRes = signerService.verifyStaticCode(staticCode.token);
    expect(verifyRes.valid).toBe(true);
    expect(verifyRes.claims.ticket_id).toBe('tkt_static_100');
    expect(verifyRes.claims.event_id).toBe('evt_101');
    expect(verifyRes.claims.v).toBe(2);
  });

  it('rejects static ticket token when submitted to verifyJWSReceipt', () => {
    const staticCode = signerService.generateStaticCode({
      ticketId: 'tkt_static_100',
      version: 1,
      eventId: 'evt_101'
    });

    const verifyRes = signerService.verifyJWSReceipt(staticCode.token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.reason).toContain('token use \'static_ticket\' is not a receipt');
  });

  it('rejects receipt token when submitted to verifyStaticCode', () => {
    const receipt = signerService.generateJWSReceipt({ ticketId: 'tkt_receipt_100' });
    // Manually sign receipt with use: 'receipt' claim
    const receiptWithUse = jwt.sign(
      {
        ticket_id: 'tkt_receipt_100',
        issued_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 60,
        nonce: 'nonce-789',
        use: 'receipt',
        issuer: 'urn:events:operator:main',
        schema_version: '1.0'
      },
      signerService.keys.get(signerService.activeKeyId),
      { algorithm: 'HS256', header: { kid: signerService.activeKeyId, typ: 'JWT' } }
    );

    const verifyRes = signerService.verifyStaticCode(receiptWithUse);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.reason).toContain('expected \'static_ticket\'');
  });
});
