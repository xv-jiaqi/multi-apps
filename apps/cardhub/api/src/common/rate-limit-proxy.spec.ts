import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import request from 'supertest';

function makeLimitedApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 1,
      standardHeaders: false,
      legacyHeaders: false,
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    }),
  );
  app.get('/limited', (req, res) => {
    res.status(200).json({ ip: req.ip });
  });

  return app;
}

describe('rate limit proxy IP handling', () => {
  it('uses separate buckets for different client IPs behind one trusted proxy', async () => {
    const app = makeLimitedApp();

    await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.10').expect(200);
    await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.11').expect(200);
    await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.10').expect(429);
  });

  it('does not let a spoofed extra X-Forwarded-For entry create a new bucket', async () => {
    const app = makeLimitedApp();

    await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.10').expect(200);
    await request(app)
      .get('/limited')
      .set('X-Forwarded-For', '198.51.100.250, 203.0.113.10')
      .expect(429);
  });
});
