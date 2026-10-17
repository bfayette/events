const express = require('express');
const router = express.Router();
const aaService = require('./aa.service');
const eventsService = require('../events/events.service');

// POST /api/aa/transfer-ticket (Constructs UserOp intent for gasless ticket transfer)
router.post('/transfer-ticket', (req, res) => {
  try {
    const { ticketId, recipientAddress, senderAddress, nonce } = req.body;

    if (!ticketId || !recipientAddress) {
      return res.status(400).json({ message: 'ticketId and recipientAddress are required' });
    }

    const ticket = eventsService.tickets.get(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const userOp = aaService.createTicketTransferUserOp({
      ticketId,
      senderAddress: senderAddress || ticket.ownerAddress,
      recipientAddress,
      nonce
    });

    return res.json({
      message: 'Ticket transfer UserOp intent constructed',
      userOp
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to build transfer intent', error: error.message });
  }
});

// POST /api/aa/redeem-points (Constructs UserOp intent for loyalty points redemption)
router.post('/redeem-points', (req, res) => {
  try {
    const { loyaltyId, points, rewardId, senderAddress, nonce } = req.body;

    if (!loyaltyId || !points) {
      return res.status(400).json({ message: 'loyaltyId and points are required' });
    }

    const loyalty = eventsService.loyaltyAccounts.get(loyaltyId);
    if (!loyalty) {
      return res.status(404).json({ message: 'Loyalty account not found' });
    }

    if (loyalty.points < points) {
      return res.status(400).json({ message: 'Insufficient loyalty points balance' });
    }

    const userOp = aaService.createPointsRedemptionUserOp({
      loyaltyId,
      points,
      rewardId: rewardId || 'reward_default',
      senderAddress: senderAddress || loyalty.ownerAddress,
      nonce
    });

    return res.json({
      message: 'Loyalty redemption UserOp intent constructed',
      userOp
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to build redemption intent', error: error.message });
  }
});

// POST /api/aa/dispatch (Relays client-signed UserOp to Paymaster / Bundler)
router.post('/dispatch', async (req, res) => {
  try {
    const { userOp, signature } = req.body;

    if (!userOp) {
      return res.status(400).json({ message: 'userOp payload is required' });
    }

    const dispatchResult = await aaService.dispatchUserOp(userOp, signature);

    // E2E update state on successful dispatch simulation
    if (userOp.callData && userOp.callData.includes('_transferTicket_')) {
      const match = userOp.callData.match(/_transferTicket_(.+)_to_(.+)/);
      if (match) {
        const ticketId = match[1];
        const newOwner = match[2];
        const ticket = eventsService.tickets.get(ticketId);
        if (ticket) {
          ticket.ownerAddress = newOwner;
          ticket.status = 'TRANSFERRED';
        }
      }
    } else if (userOp.callData && userOp.callData.includes('_redeemPoints_')) {
      const parts = userOp.callData.split('_');
      const loyaltyId = parts[2];
      const pointsRedeemed = parseInt(parts[3], 10);
      const loyalty = eventsService.loyaltyAccounts.get(loyaltyId);
      if (loyalty && !isNaN(pointsRedeemed)) {
        loyalty.points = Math.max(0, loyalty.points - pointsRedeemed);
      }
    }

    return res.json({
      message: 'UserOperation dispatched successfully via Paymaster',
      result: dispatchResult
    });
  } catch (error) {
    return res.status(500).json({ message: 'UserOperation dispatch failed', error: error.message });
  }
});

module.exports = router;
