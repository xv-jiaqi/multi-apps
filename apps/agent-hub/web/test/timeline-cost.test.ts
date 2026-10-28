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

describe('时间线处理耗时', () => {
  it('一万条新事件在线性时间内记完 seq，重复投递不再变化', () => {
    measure(1_000);
    const ten = measure(10_000);
    const twenty = measure(20_000);
    expect(ten.lastSeq).toBe(10_000);
    expect(ten.items).toBe(0);
    expect(ten.repeat).toBe(false);
    expect(twenty.lastSeq).toBe(20_000);
    expect(ten.elapsed).toBeLessThan(400);
    expect(twenty.elapsed).toBeLessThan(800);
  });
});
