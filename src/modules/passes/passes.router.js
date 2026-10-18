const express = require('express');
const router = express.Router();
const eventsService = require('../events/events.service');
const PassDataMapper = require('./pass.mapper');
const PassGeneratorService = require('./pass.generator');

// GET /api/tickets/:id/apple-pass
router.get('/tickets/:id/apple-pass', async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = eventsService.tickets.get(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const event = eventsService.events.get(ticket.eventId);
    const applePassData = PassDataMapper.toAppleEventPass(ticket, event);
    const pkpassBuffer = await PassGeneratorService.createApplePkPassBuffer(applePassData);

    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Content-Disposition', `attachment; filename=ticket-${ticketId}.pkpass`);
    return res.send(pkpassBuffer);
  } catch (error) {
    console.error('Error generating Apple Pass:', error);
    return res.status(500).json({ message: 'Error generating Apple Pass' });
  }
});

// GET /api/tickets/:id/google-pass-url
router.get('/tickets/:id/google-pass-url', (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = eventsService.tickets.get(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const event = eventsService.events.get(ticket.eventId);
    const googleClaims = PassDataMapper.toGoogleEventPass(ticket, event);
    const saveUrl = PassGeneratorService.createGoogleWalletSaveUrl(googleClaims);

    return res.json({ saveUrl, claims: googleClaims });
  } catch (error) {
    console.error('Error generating Google Pass URL:', error);
    return res.status(500).json({ message: 'Error generating Google Pass URL' });
  }
});

// GET /api/loyalty/:id/apple-pass
router.get('/loyalty/:id/apple-pass', async (req, res) => {
  try {
    const loyaltyId = req.params.id;
    const loyalty = eventsService.loyaltyAccounts.get(loyaltyId);
    if (!loyalty) {
      return res.status(404).json({ message: 'Loyalty account not found' });
    }

    const applePassData = PassDataMapper.toAppleLoyaltyPass(loyalty);
    const pkpassBuffer = await PassGeneratorService.createApplePkPassBuffer(applePassData);

    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Content-Disposition', `attachment; filename=loyalty-${loyaltyId}.pkpass`);
    return res.send(pkpassBuffer);
  } catch (error) {
    console.error('Error generating Apple Loyalty Pass:', error);
    return res.status(500).json({ message: 'Error generating Apple Loyalty Pass' });
  }
});

// GET /api/loyalty/:id/google-pass-url
router.get('/loyalty/:id/google-pass-url', (req, res) => {
  try {
    const loyaltyId = req.params.id;
    const loyalty = eventsService.loyaltyAccounts.get(loyaltyId);
    if (!loyalty) {
      return res.status(404).json({ message: 'Loyalty account not found' });
    }

    const googleClaims = PassDataMapper.toGoogleLoyaltyPass(loyalty);
    const saveUrl = PassGeneratorService.createGoogleWalletSaveUrl(googleClaims);

    return res.json({ saveUrl, claims: googleClaims });
  } catch (error) {
    console.error('Error generating Google Loyalty Pass URL:', error);
    return res.status(500).json({ message: 'Error generating Google Loyalty Pass URL' });
  }
});

module.exports = router;
