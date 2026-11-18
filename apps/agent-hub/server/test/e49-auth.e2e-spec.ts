import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module';
import { httpPipeline } from '../src/api/http-pipeline';
import { WsHub } from '../src/api/ws-hub';
import { AuthService } from '../src/auth/auth.service';
import { HubLogger } from '../src/common/logger';
import { resolvePaths } from '../src/common/paths';
import { HubConfigService } from '../src/config/config.service';
import { migrate } from '../src/db/migrations';
import { Db } from '../src/db/sqlite';
import { Lifecycle } from '../src/lifecycle';

describe('E49 Host / Origin / token', () => {
  let app: NestExpressApplication;
  let dir: string;
  let db: Db;
  let auth: AuthService;
  let port: number;
  let uiToken: string;
  let bridgeToken: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ah-e49-'));
    process.env.AGENT_HUB_HOME = dir;
    const paths = resolvePaths(process.env);
    const logger = new HubLogger(paths);
    const config = new HubConfigService(paths);
    config.loadOrCreate();
    db = new Db(paths.db);
    migrate(db);
    auth = new AuthService(db, paths);
    auth.ensureDefaultToken();
    uiToken = auth.bootstrapUiToken();
    bridgeToken = readFileSync(paths.bridgeToken, 'utf8').trim();

    app = await NestFactory.create<NestExpressApplication>(
      AppModule.register({ paths, db, logger, config, auth }),
      { logger: false, bodyParser: false },
    );
    app.setGlobalPrefix('api/v1');
    const lifecycle = app.get(Lifecycle);
    port = 47821 + Math.floor(Math.random() * 1000);
    for (const mw of httpPipeline({
      port,
      isShuttingDown: () => lifecycle.isShuttingDown(),
      authenticate: (token) => auth.authenticate(token),
      takeRateToken: (id) => auth.takeRateToken(id),
    })) {
      app.use(mw);
    }
    await app.listen(port, '127.0.0.1');
    app.get(WsHub).attach(app.getHttpServer(), port);
  });

  afterAll(async () => {
    try {
      app.get(WsHub).onModuleDestroy();
    } catch {
      // ignore
    }
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('E49 illegal Host → 421 HOST_FORBIDDEN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Host', 'evil.example')
      .expect(421);
    expect(res.body.error.code).toBe('HOST_FORBIDDEN');
  });

  it('E49 illegal Origin → 403 ORIGIN_FORBIDDEN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Host', `127.0.0.1:${port}`)
      .set('Origin', 'https://evil.example')
      .set('Authorization', `Bearer ${uiToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('ORIGIN_FORBIDDEN');
  });

  it('E49 no token → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Host', `127.0.0.1:${port}`)
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('E49 health is public', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Host', `127.0.0.1:${port}`)
      .expect(200);
    expect(res.body.app).toBe('agent-hub');
  });

  it('E49 valid ui token → me ok; bridge cannot list tokens', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Host', `127.0.0.1:${port}`)
      .set('Authorization', `Bearer ${uiToken}`)
      .expect(200)
      .expect((r) => {
        expect(r.body.kind).toBe('ui');
        expect(r.body.admin).toBe(true);
      });

    const denied = await request(app.getHttpServer())
      .get('/api/v1/tokens')
      .set('Host', `127.0.0.1:${port}`)
      .set('Authorization', `Bearer ${bridgeToken}`)
      .expect(403);
    expect(denied.body.error.code).toBe('ADMIN_ONLY');
  });

  it('E49 revoked token → 401; WS closes 4401', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/tokens')
      .set('Host', `127.0.0.1:${port}`)
      .set('Authorization', `Bearer ${uiToken}`)
      .send({ name: 'tmp', scopes: ['tasks:read'] })
      .expect(201);
    const token = created.body.token as string;
    const id = created.body.id as string;

    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws`, {
        headers: { Host: `127.0.0.1:${port}` },
      });
      let revoked = false;
      ws.on('open', () => {
        ws.send(JSON.stringify({ op: 'auth', token }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(String(data)) as { op: string };
        if (msg.op === 'ready' && !revoked) {
          revoked = true;
          void request(app.getHttpServer())
            .post(`/api/v1/tokens/${id}/revoke`)
            .set('Host', `127.0.0.1:${port}`)
            .set('Authorization', `Bearer ${uiToken}`)
            .expect(201)
            .catch(async () => {
              await request(app.getHttpServer())
                .post(`/api/v1/tokens/${id}/revoke`)
                .set('Host', `127.0.0.1:${port}`)
                .set('Authorization', `Bearer ${uiToken}`)
                .expect(200);
            });
        }
      });
      ws.on('close', (code) => resolve(code));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws revoke timeout')), 8000);
    });
    expect(closeCode).toBe(4401);

    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Host', `127.0.0.1:${port}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
