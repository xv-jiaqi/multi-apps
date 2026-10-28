import { createTimelineStore } from '../src/lib/timeline';
import { envelope, task } from './fixtures';

function measure(count: number): {
  elapsed: number;
  lastSeq: number;
  items: number;
  repeat: boolean;
} {
  const store = createTimelineStore();
  const batch = statuses(count);
  const started = performance.now();
  store.apply(batch);
  const elapsed = performance.now() - started;
  return {
    elapsed,
    lastSeq: store.snapshot(task().id).lastSeq,
    items: store.snapshot(task().id).items.length,
    repeat: store.apply(batch),
  };
}

function statuses(count: number) {
  const taskId = task().id;
  return Array.from({ length: count }, (_, index) =>
    envelope({ type: 'task.status', from: 'running', to: 'running' }, { seq: index + 1, taskId }),
  );
}

function elapsed(count: number, rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round += 1) {
    const store = createTimelineStore();
    const batch = statuses(count);
    const started = performance.now();
    store.apply(batch);
    total += performance.now() - started;
  }
  return total;
}

describe('时间线处理耗时', () => {
  it('2 万条的耗时不到 1 万条的 3 倍，重复投递不再变化', () => {
    measure(1_000);
    const ten = elapsed(10_000, 6);
    const twenty = elapsed(20_000, 6);
    const sample = measure(10_000);
    expect(sample.lastSeq).toBe(10_000);
    expect(sample.items).toBe(0);
    expect(sample.repeat).toBe(false);
    expect(measure(20_000).lastSeq).toBe(20_000);
    expect(twenty / ten).toBeLessThan(3);
  });
});
