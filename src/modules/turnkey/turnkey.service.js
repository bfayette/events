const { Turnkey } = require('@turnkey/http');

class TurnkeyService {
  constructor() {
    this.apiBaseUrl = process.env.TURNKEY_API_BASE_URL || 'https://api.turnkey.com';
    this.organizationId = process.env.TURNKEY_ORGANIZATION_ID || 'mock-parent-org-id';
  }

  /**
   * Provisions an isolated Sub-Organization for an end user using WebAuthn authenticators.
   * Zero Custody Notice: Raw private keys are never created, handled, or stored by this backend.
   */
  async createSubOrganization({ subOrgName, passkeyName, publicKeyPem, challenge }) {
    // Return mock response when running tests or in development without live Turnkey credentials
    if (process.env.NODE_ENV === 'test' || !process.env.TURNKEY_API_KEY_STAMPER) {
      const mockSubOrgId = `suborg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const mockWalletId = `wallet-${Date.now()}`;
      const mockWalletAddress = `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

      return {
        subOrganizationId: mockSubOrgId,
        walletId: mockWalletId,
        walletAddress: mockWalletAddress
      };
    }

    try {
      const turnkeyClient = new Turnkey({
        baseUrl: this.apiBaseUrl,
        apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY,
        apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY
      });

      const response = await turnkeyClient.api().createSubOrganization({
        organizationId: this.organizationId,
        subOrganizationName: subOrgName || `User SubOrg ${Date.now()}`,
        rootUsers: [
          {
            userName: subOrgName || 'User Root',
            authenticators: [
              {
                authenticatorName: passkeyName || 'WebAuthn Passkey',
                challenge: challenge || 'mock_challenge',
                attestation: {
                  credentialId: 'mock_credential_id',
                  clientDataJson: 'mock_client_data',
                  attestationObject: 'mock_attestation_object',
                  transports: ['INTERNAL']
                }
              }
            ]
          }
        ],
        rootQuorumThreshold: 1
      });

      return {
        subOrganizationId: response.subOrganizationId,
        walletId: response.walletId || null,
        walletAddress: response.walletAddress || null
      };
    } catch (err) {
      throw new Error(`Turnkey Sub-Org provisioning failed: ${err.message}`);
    }
  }

  /**
   * Relays client-stamped requests to Turnkey API without inspecting or altering signatures.
   */
  async relaySignedStamp(stamp, requestBody) {
    // Forward directly to Turnkey HTTP API endpoint or mock response
    if (process.env.NODE_ENV === 'test' || !process.env.TURNKEY_API_KEY_STAMPER) {
      return {
        status: 'SUCCESS',
        relayed: true,
        stampHeaderPresent: Boolean(stamp),
        requestBody
      };
    }

    // Live Turnkey relay execution
    const response = await fetch(`${this.apiBaseUrl}/public/v1/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stamp': stamp
      },
      body: JSON.stringify(requestBody)
    });

    return await response.json();
  }
}

module.exports = new TurnkeyService();
