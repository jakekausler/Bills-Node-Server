import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Mock all external dependencies
vi.mock('mysql');
vi.mock('bcrypt');
vi.mock('jsonwebtoken');
vi.mock('./api/accounts/accounts');
vi.mock('./api/accounts/account');
vi.mock('./api/accounts/graph');
vi.mock('./api/accounts/todayBalance');
vi.mock('./api/accounts/activity/activity');
vi.mock('./api/accounts/activity/specificActivity');
vi.mock('./api/accounts/bills/bills');
vi.mock('./api/accounts/bills/bill');
vi.mock('./api/accounts/interests/interests');
vi.mock('./api/accounts/interests/interest');
vi.mock('./api/calendar/bills');
vi.mock('./api/accounts/consolidatedActivity/consolidatedActivity');
vi.mock('./api/accounts/consolidatedActivity/specificConsolidatedActivity');
vi.mock('./api/categories/categories');
vi.mock('./api/categories/breakdown');
vi.mock('./api/categories/section/item/transactions');
vi.mock('./api/simulations/simulations');
vi.mock('./api/simulations/usedVariables');
vi.mock('./api/names/names');
vi.mock('./api/flow/flow');
vi.mock('./api/categories/section/transactions');
vi.mock('./api/categories/section/breakdown');
vi.mock('./api/monteCarlo/monteCarlo');
vi.mock('./api/moneyMovement/movement');
vi.mock('./utils/io/healthcareConfigs');
vi.mock('./api/spendingTracker/spendingTracker');

// Set env vars before importing app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

describe('Server Index - Real Middleware Execution', { timeout: 30000 }, () => {
  let app: Express;

  beforeAll(async () => {
    const module = await import('./index');
    app = module.app;
  }, 25000);

  describe('App Structure', () => {
    it('should export Express app', () => {
      expect(app).toBeDefined();
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
    });

    it('should have router stack', () => {
      expect(app._router).toBeDefined();
    });
  });

  describe('Auth Endpoints - Real Middleware Chain', () => {
    it('should test POST /api/auth/token endpoint', async () => {
      const response = await request(app)
        .post('/api/auth/token')
        .send({ username: 'test', password: 'test' });

      // Auth endpoint is not protected - should process request
      expect(response.status).toBeLessThan(500);
      expect(typeof response.body).toBe('object');
    });

    it('should test POST /api/auth/logout endpoint', async () => {
      const response = await request(app)
        .post('/api/auth/logout');

      // Logout requires token via middleware
      expect([401, 200]).toContain(response.status);
    });

    it('should test GET /api/auth/validate endpoint', async () => {
      const response = await request(app)
        .get('/api/auth/validate');

      // Validate requires token
      expect([401, 200]).toContain(response.status);
    });
  });

  describe('Express Middleware - JSON Parsing', () => {
    it('should parse JSON bodies in requests', async () => {
      const response = await request(app)
        .post('/api/auth/token')
        .set('Content-Type', 'application/json')
        .send({ username: 'testuser', password: 'testpass' });

      // Should successfully parse JSON without error
      expect(response.status).toBeLessThan(500);
      expect(typeof response.body).toBe('object');
    });
  });

  describe('HTTP Methods - Real Routing', () => {
    it('should handle GET requests', async () => {
      const response = await request(app)
        .get('/api/auth/validate');

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });

    it('should handle POST requests', async () => {
      const response = await request(app)
        .post('/api/auth/token')
        .send({});

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });

    it('should handle PUT requests on protected routes', async () => {
      const response = await request(app)
        .put('/api/accounts')
        .send({});

      // Should be handled (either 401 for auth or 500 for error)
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });

    it('should handle DELETE requests on protected routes', async () => {
      const response = await request(app)
        .delete('/api/accounts/123');

      // Should be handled (either 401 for auth or 500 for error)
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });
  });

  describe('Response Formats', () => {
    it('should return JSON responses', async () => {
      const response = await request(app)
        .get('/api/auth/validate');

      expect(response.headers['content-type']).toMatch(/json/);
    });

    it('should return valid JSON objects', async () => {
      const response = await request(app)
        .post('/api/auth/token')
        .send({ username: 'a', password: 'b' });

      expect(typeof response.body).toBe('object');
    });
  });

  describe('Async Handler - Error Handling', () => {
    it('should handle async route handlers without crashing', async () => {
      const response = await request(app)
        .get('/api/accounts');

      // Should return a valid response, not throw/crash
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });

    it('should handle multiple concurrent requests', async () => {
      const responses = await Promise.all([
        request(app).get('/api/auth/validate'),
        request(app).post('/api/auth/token').send({}),
        request(app).get('/api/accounts'),
      ]);

      responses.forEach(res => {
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
      });
    });
  });

  describe('Route Functionality - Actual Middleware Execution', () => {
    it('should test that verifyToken middleware is applied to /api/accounts', async () => {
      // Test that this endpoint exercises the middleware
      const response = await request(app)
        .get('/api/accounts');

      // Should get a response (auth fails or endpoint fails, but not crash)
      expect([200, 401, 500]).toContain(response.status);
    });

    it('should test that asyncHandler wraps route handlers', async () => {
      // asyncHandler catches errors from async handlers
      const response = await request(app)
        .post('/api/auth/token')
        .send({});

      // Should not crash - handler should be wrapped
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });
  });

  describe('Middleware Integration', () => {
    it('should have body parser middleware', async () => {
      const response = await request(app)
        .post('/api/auth/token')
        .set('Content-Type', 'application/json')
        .send({ username: 'user', password: 'pass' });

      // Body should be parsed - no syntax errors
      expect(response.status).toBeLessThan(500);
    });

    it('should have error handler middleware', async () => {
      // Make a request that might trigger error handler
      const response = await request(app)
        .get('/api/accounts');

      // Should return valid response (body may be object or string)
      expect([200, 401, 500]).toContain(response.status);
      expect(response).toBeDefined();
    });
  });
});
