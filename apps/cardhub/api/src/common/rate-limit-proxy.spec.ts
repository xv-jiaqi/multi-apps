import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import request from 'supertest';
import { configureApp } from '../bootstrap/configure-app';

@Module({})
class TestModule {}

async function makeLimitedApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication();
  const expressApp = configureApp(app);
  expressApp.use(
    rateLimit({
      windowMs: 60_000,
      limit: 1,
      standardHeaders: false,
      legacyHeaders: false,
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    }),
  );
  expressApp.get('/limited', (req, res) => {
    res.status(200).json({ ip: req.ip });
  });
  await app.init();

  return app;
}

describe('rate limit proxy IP handling', () => {
  it('uses separate buckets for different client IPs behind one trusted proxy', async () => {
    const app = await makeLimitedApp();
    try {
      await request(app.getHttpServer())
        .get('/limited')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(200);
      await request(app.getHttpServer())
        .get('/limited')
        .set('X-Forwarded-For', '203.0.113.11')
        .expect(200);
      await request(app.getHttpServer())
        .get('/limited')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(429);
    } finally {
      await app.close();
    }
  });

  it('does not let a spoofed extra X-Forwarded-For entry create a new bucket', async () => {
    const app = await makeLimitedApp();
    try {
      await request(app.getHttpServer())
        .get('/limited')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(200);
      await request(app.getHttpServer())
        .get('/limited')
        .set('X-Forwarded-For', '198.51.100.250, 203.0.113.10')
        .expect(429);
    } finally {
      await app.close();
    }
  });
});
