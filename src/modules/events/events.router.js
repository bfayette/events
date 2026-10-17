const express = require('express');
const router = express.Router();
const eventsService = require('./events.service');

router.get('/', (req, res) => {
  res.json(Array.from(eventsService.events.values()));
});

router.get('/:id', (req, res) => {
  const event = eventsService.events.get(req.params.id);
  if (!event) {
    return res.status(404).json({ message: 'Event not found' });
  }
  res.json(event);
});

module.exports = router;
