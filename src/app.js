const express = require('express');
const eventsRouter = require('./modules/events/events.router');
const ticketsRouter = require('./modules/events/tickets.router');
const passesRouter = require('./modules/passes/passes.router');
const validationRouter = require('./modules/validation/validation.router');
const lookupRouter = require('./modules/validation/lookup.router');

const app = express();

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'headless-ticketing-platform' });
});

// Domain Routes
app.use('/api/tickets', ticketsRouter);
app.use('/api/lookup', lookupRouter);
app.use('/api/events', eventsRouter);
app.use('/api/passes', validationRouter);
app.use('/api', passesRouter); // Handles /api/tickets/:id/... and /api/loyalty/...

module.exports = app;
