const express = require('express');
const router = express.Router();
const anchoringService = require('./anchoring.service');

// POST /api/anchoring/anchor — Trigger Merkle batch anchoring
router.post('/anchor', (req, res) => {
  try {
    const { chainId, operator } = req.body;
    const result = anchoringService.anchorPendingEvents({ chainId, operator });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Anchoring batch failed:', error);
    return res.status(500).json({ message: 'Anchoring batch failed' });
  }
});

// GET /api/anchoring/anchors — List all Merkle anchor batches
router.get('/anchors', (req, res) => {
  try {
    const anchors = anchoringService.getAllAnchors();
    return res.status(200).json({ count: anchors.length, anchors });
  } catch (error) {
    console.error('Failed to retrieve anchors:', error);
    return res.status(500).json({ message: 'Failed to retrieve anchors' });
  }
});

// GET /api/anchoring/anchors/:id — Get details of a specific anchor
router.get('/anchors/:id', (req, res) => {
  try {
    const anchor = anchoringService.getAnchorById(req.params.id);
    if (!anchor) {
      return res.status(404).json({ message: 'Anchor batch not found' });
    }
    return res.status(200).json(anchor);
  } catch (error) {
    console.error('Failed to retrieve anchor:', error);
    return res.status(500).json({ message: 'Failed to retrieve anchor' });
  }
});

module.exports = router;
