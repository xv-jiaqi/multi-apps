/**
 * 测试侧车用系统分配的端口（#315 复审非阻塞 ①）：原来是 48100 + 随机数，并行套件偶尔撞端口，
 * E53 / ws-limits 的偶发失败就是 listen EADDRINUSE。这里同时起几台，端口互不相同、都和实际监听的一致，
 * Host 校验按实际端口生效；close() 可以重复调用。
 */
import { listeningPort } from './helpers/ports';
import { api, startHub, type TestHub } from './helpers/hub';

describe('测试侧车端口', () => {
  const hubs: TestHub[] = [];
  afterAll(async () => {
    await Promise.allSettled(hubs.map((h) => h.close()));
  });

  it('并行起 6 台：端口由系统分配、互不相同，/health 正常；close 可重复调用', async () => {
    // allSettled：有一台起不来时，已经起来的也都进 hubs，由 afterAll 关掉（#319 审查非阻塞 ②）。
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () => startHub('codex-readonly-demo')),
    );
    for (const r of settled) if (r.status === 'fulfilled') hubs.push(r.value);
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
    const ports = hubs.map((h) => h.port);
    expect(new Set(ports).size).toBe(ports.length);
    for (const h of hubs) {
      expect(h.port).toBe(listeningPort(h.app.getHttpServer()));
      expect((await api(h, 'GET', '/health')).status).toBe(200);
    }
    await hubs[0]!.close();
    await expect(hubs[0]!.close()).resolves.toBeUndefined();
  });
});
