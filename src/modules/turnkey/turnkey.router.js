const express = require('express');
const router = express.Router();
const turnkeyService = require('./turnkey.service');

// Store provisioned user wallets in-memory
const userWallets = new Map();

// POST /api/users/provision-wallet
router.post('/provision-wallet', async (req, res) => {
  try {
    const { userId, subOrgName, passkeyName, publicKeyPem, challenge } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const subOrgResult = await turnkeyService.createSubOrganization({
      subOrgName: subOrgName || `User-${userId}`,
      passkeyName,
      publicKeyPem,
      challenge
    });

    const userRecord = {
      userId,
      subOrganizationId: subOrgResult.subOrganizationId,
      walletId: subOrgResult.walletId,
      walletAddress: subOrgResult.walletAddress,
      createdAt: new Date().toISOString()
    };

    userWallets.set(userId, userRecord);

    return res.status(201).json({
      message: 'Sub-organization and wallet provisioned successfully',
      user: userRecord
    });
  } catch (error) {
    return res.status(500).json({ message: 'Provisioning failed', error: error.message });
  }
});

// GET /api/users/:userId/wallet
router.get('/:userId/wallet', (req, res) => {
  const userRecord = userWallets.get(req.params.userId);
  if (!userRecord) {
    return res.status(404).json({ message: 'User wallet record not found' });
  }
  return res.json(userRecord);
});

// POST /api/turnkey/proxy (Relay client-stamped requests directly to Turnkey)
router.post('/proxy', async (req, res) => {
  try {
    const stamp = req.headers['x-stamp'] || req.headers['x-turnkey-stamp'];
    const result = await turnkeyService.relaySignedStamp(stamp, req.body);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Relay proxy failed', error: error.message });
  }
});

module.exports = router;
