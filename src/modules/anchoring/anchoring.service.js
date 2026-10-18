const crypto = require('crypto');
const eventsService = require('../events/events.service');

class AnchoringService {
  /**
   * Helper function to compute Merkle Root from an array of SHA-256 hashes
   */
  computeMerkleRoot(hashes) {
    if (!hashes || hashes.length === 0) {
      return null;
    }
    if (hashes.length === 1) {
      return hashes[0].startsWith('0x') ? hashes[0] : `0x${hashes[0]}`;
    }

    let currentLevel = hashes.map(h => h.startsWith('0x') ? h.slice(2) : h);

    while (currentLevel.length > 1) {
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const combined = crypto.createHash('sha256').update(left + right).digest('hex');
        nextLevel.push(combined);
      }
      currentLevel = nextLevel;
    }

    return `0x${currentLevel[0]}`;
  }

  /**
   * Batches all unanchored audit log events, builds Merkle root, and records anchor transaction
   */
  anchorPendingEvents({ chainId = 137, operator = 'anchoring_worker' } = {}) {
    const unanchoredEvents = eventsService.getUnanchoredEvents();

    if (unanchoredEvents.length === 0) {
      return {
        anchored: false,
        reason: 'No unanchored events available for batching'
      };
    }

    const eventIds = unanchoredEvents.map(e => e.id);
    const hashes = unanchoredEvents.map(e => e.payloadHash);
    const merkleRoot = this.computeMerkleRoot(hashes);

    const anchorId = `anc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;

    const anchorRecord = {
      id: anchorId,
      merkleRoot,
      batchSize: unanchoredEvents.length,
      chainId,
      txHash,
      blockNumber: Math.floor(Math.random() * 1000000) + 50000000,
      eventIds,
      anchoredAt: new Date().toISOString()
    };

    // Store anchor record
    eventsService.merkleAnchors.set(anchorId, anchorRecord);

    // Update event records with anchorId
    eventsService.markEventsAnchored(eventIds, anchorId);

    // Append anchor event to log
    eventsService.logEvent({
      ticketId: 'SYSTEM',
      action: 'ANCHOR',
      actor: operator,
      payload: { anchorId, merkleRoot, batchSize: unanchoredEvents.length, txHash, chainId },
      statusTransition: `UNANCHORED -> ANCHORED (${anchorId})`
    });

    return {
      anchored: true,
      anchorId,
      merkleRoot,
      batchSize: unanchoredEvents.length,
      chainId,
      txHash,
      blockNumber: anchorRecord.blockNumber,
      anchoredAt: anchorRecord.anchoredAt
    };
  }

  /**
   * Retrieve anchor details by anchor ID
   */
  getAnchorById(anchorId) {
    return eventsService.merkleAnchors.get(anchorId) || null;
  }

  /**
   * List all Merkle anchors
   */
  getAllAnchors() {
    return Array.from(eventsService.merkleAnchors.values());
  }
}

module.exports = new AnchoringService();
