class AccountAbstractionService {
  constructor() {
    this.entryPointAddress = process.env.ERC4337_ENTRYPOINT || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
    this.paymasterUrl = process.env.ERC4337_PAYMASTER_URL || 'https://paymaster.platform.com/v1/sponsor';
    this.bundlerUrl = process.env.ERC4337_BUNDLER_URL || 'https://bundler.platform.com/v1/rpc';
  }

  /**
   * Constructs an ERC-4337 UserOperation intent object for ticket transfer
   */
  createTicketTransferUserOp({ ticketId, senderAddress, recipientAddress, nonce = '0x0' }) {
    return {
      sender: senderAddress,
      nonce: nonce,
      initCode: '0x', // Existing smart account
      callData: `0x_transferTicket_${ticketId}_to_${recipientAddress}`,
      callGasLimit: '0x10000',
      verificationGasLimit: '0x10000',
      preVerificationGas: '0x5000',
      maxFeePerGas: '0x3B9ACA00',
      maxPriorityFeePerGas: '0x3B9ACA00',
      paymasterAndData: '0x_paymaster_sponsored_gasless_v1',
      signature: '0x' // To be client-stamped by WebAuthn / Passkey signature
    };
  }

  /**
   * Constructs an ERC-4337 UserOperation intent object for loyalty points redemption
   */
  createPointsRedemptionUserOp({ loyaltyId, points, rewardId, senderAddress, nonce = '0x0' }) {
    return {
      sender: senderAddress,
      nonce: nonce,
      initCode: '0x',
      callData: `0x_redeemPoints_${loyaltyId}_${points}_reward_${rewardId}`,
      callGasLimit: '0x12000',
      verificationGasLimit: '0x10000',
      preVerificationGas: '0x5000',
      maxFeePerGas: '0x3B9ACA00',
      maxPriorityFeePerGas: '0x3B9ACA00',
      paymasterAndData: '0x_paymaster_sponsored_gasless_v1',
      signature: '0x'
    };
  }

  /**
   * Dispatches signed UserOperation intent to ERC-4337 Paymaster & Bundler
   */
  async dispatchUserOp(userOp, userSignature) {
    if (!userOp || !userOp.sender || !userOp.callData) {
      throw new Error('Invalid UserOperation payload');
    }

    const signedUserOp = {
      ...userOp,
      signature: userSignature || userOp.signature || '0x_mock_client_webauthn_signature'
    };

    // Return mock dispatch execution in test / dev mode
    if (process.env.NODE_ENV === 'test' || !process.env.ERC4337_LIVE) {
      const userOpHash = `0x_userop_hash_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const txHash = `0x_tx_hash_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      return {
        status: 'SUBMITTED',
        userOpHash,
        transactionHash: txHash,
        entryPoint: this.entryPointAddress,
        paymasterSponsored: true
      };
    }

    // Live Bundler dispatch call
    const response = await fetch(this.bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendUserOperation',
        params: [signedUserOp, this.entryPointAddress]
      })
    });

    const result = await response.json();
    return result;
  }
}

module.exports = new AccountAbstractionService();
