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
