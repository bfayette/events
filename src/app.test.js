const request = require('supertest');
const app = require('./app');

describe('App & Modular Architecture Setup', () => {
  it('should respond with health check status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({
      status: 'ok',
      service: 'headless-ticketing-platform'
    });
  });

  it('should serve events list endpoint', async () => {
    const res = await request(app).get('/api/events');
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
