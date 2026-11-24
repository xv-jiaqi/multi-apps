/** local-api.md §6.3–§6.4：回放衔接不重不漏；跟随阶段不串行，积压留在 socket 上。 */
import type { HubEventEnvelope } from '@agent-hub/contract';
import { replayThenFollow, type EventFeed } from './replay';

const env = (seq: number): HubEventEnvelope => ({
  taskId: 't',
  seq,
  turnId: null,
  ts: '2026-11-24T00:00:00.000Z',
  event: { type: 'notice', level: 'info', message: String(seq) },
});

class FakeFeed implements EventFeed {
  readonly rows: HubEventEnvelope[] = [];
  readonly listeners = new Set<(e: HubEventEnvelope) => void>();
  listCalls: Array<[number, number]> = [];
  failList = false;
  add(n: number): void {
    for (let i = 0; i < n; i++) {
      const e = env(this.rows.length + 1);
      this.rows.push(e);
      for (const l of this.listeners) l(e);
    }
  }
  list(_taskId: string, afterSeq: number, limit: number): HubEventEnvelope[] {
    this.listCalls.push([afterSeq, limit]);
    if (this.failList) throw new Error('db closed');
    return this.rows.filter((e) => e.seq > afterSeq).slice(0, limit);
  }
  subscribe(_taskId: string, listener: (e: HubEventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const tick = () => new Promise((r) => setImmediate(r));

describe('replayThenFollow', () => {
  it('分页回放 afterSeq 之后的事件，回放期间新来的事件不重不漏', async () => {
    const feed = new FakeFeed();
    feed.add(1203);
    const got: number[] = [];
    const unsub = await replayThenFollow(
      feed,
      't',
      100,
      (e) => {
        got.push(e.seq);
        if (e.seq % 300 === 0) feed.add(2); // 边回放边写
        return Promise.resolve();
      },
      new AbortController().signal,
    );
    feed.add(3);
    const last = feed.rows.length;
    expect(got).toEqual(Array.from({ length: last - 100 }, (_, i) => i + 101));
    expect(feed.listCalls.every(([, limit]) => limit === 500)).toBe(true);
    unsub();
    feed.add(1);
    expect(got.at(-1)).toBe(last); // 取消后不再转发
  });

  it('回放阶段逐条等写完（背压）：上一条没写完不发下一条', async () => {
    const feed = new FakeFeed();
    feed.add(3);
    const resolvers: Array<() => void> = [];
    const sent: number[] = [];
    const done = replayThenFollow(
      feed,
      't',
      0,
      (e) => {
        sent.push(e.seq);
        return new Promise<void>((r) => resolvers.push(r));
      },
      new AbortController().signal,
    );
    await tick();
    expect(sent).toEqual([1]);
    resolvers.shift()!();
    await tick();
    expect(sent).toEqual([1, 2]);
    resolvers.shift()!();
    await tick();
    resolvers.shift()!();
    await done;
    expect(sent).toEqual([1, 2, 3]);
  });

  it('回放卡住时新事件不进内存、不发送；客户端恢复后从库里补齐', async () => {
    const feed = new FakeFeed();
    feed.add(2);
    const resolvers: Array<() => void> = [];
    const sent: number[] = [];
    const done = replayThenFollow(
      feed,
      't',
      0,
      (e) => {
        sent.push(e.seq);
        return new Promise<void>((r) => resolvers.push(r));
      },
      new AbortController().signal,
    );
    await tick();
    feed.add(1000); // 客户端没读完第 1 条时又来了 1000 条
    expect(sent).toEqual([1]);
    while (resolvers.length) {
      resolvers.shift()!();
      await tick();
    }
    await done;
    expect(sent).toEqual(Array.from({ length: 1002 }, (_, i) => i + 1));
  });

  it('追赶（回放期间新落库的事件）也逐条等写完，不一次性写出（PR3 待办 6）', async () => {
    const feed = new FakeFeed();
    feed.add(2);
    const resolvers: Array<() => void> = [];
    let inflight = 0;
    let maxInflight = 0;
    const done = replayThenFollow(
      feed,
      't',
      0,
      () => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        return new Promise<void>((r) =>
          resolvers.push(() => {
            inflight -= 1;
            r();
          }),
        );
      },
      new AbortController().signal,
    );
    await tick();
    feed.add(1); // 第 1 页最后一条之前落库：同一页之后的追赶
    resolvers.shift()!();
    await tick();
    feed.add(3000); // 回放到最后一条时又来了几页
    while (resolvers.length) {
      resolvers.shift()!();
      await tick();
    }
    await done;
    expect(maxInflight).toBe(1);
    expect(feed.listCalls.at(-1)).toEqual([3003, 500]);
  });

  it('跟随阶段不串行：send 未完成时新事件也立即交给 send（慢消费者检查才看得到积压）', async () => {
    const feed = new FakeFeed();
    const sent: number[] = [];
    await replayThenFollow(
      feed,
      't',
      0,
      (e) => {
        sent.push(e.seq);
        return new Promise<void>(() => undefined); // 永远写不完
      },
      new AbortController().signal,
    );
    feed.add(5);
    expect(sent).toEqual([1, 2, 3, 4, 5]);
  });

  it('abort 后停止回放', async () => {
    const feed = new FakeFeed();
    feed.add(10);
    const ac = new AbortController();
    const got: number[] = [];
    await replayThenFollow(
      feed,
      't',
      0,
      (e) => {
        got.push(e.seq);
        if (e.seq === 3) ac.abort();
        return Promise.resolve();
      },
      ac.signal,
    );
    expect(got).toEqual([1, 2, 3]);
  });

  it('list 抛错：取消订阅并把错误抛给调用方', async () => {
    const feed = new FakeFeed();
    feed.failList = true;
    await expect(
      replayThenFollow(feed, 't', 0, () => Promise.resolve(), new AbortController().signal),
    ).rejects.toThrow('db closed');
    expect(feed.listeners.size).toBe(0);
  });
});
