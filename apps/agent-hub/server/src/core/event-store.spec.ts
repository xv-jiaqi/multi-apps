/** architecture.md §6：增量缓冲（200 ms / 16 KB）、非增量前强制 flush、先落库后广播、工具输出 1 MB。 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HubEventEnvelope } from '@agent-hub/contract';
import { migrate } from '../db/migrations';
import { Db } from '../db/sqlite';
import { EventBus } from './event-bus';
import {
  DELTA_FLUSH_BYTES,
  DELTA_FLUSH_MS,
  EventStore,
  TOOL_OUTPUT_CAP_BYTES,
} from './event-store';
import { redact } from '../common/redact';
import { HOLDBACK_CHARS } from './secret-holdback';

function insertTask(db: Db, id: string): void {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO tasks (id, short_id, title, agent_id, adapter_kind, repo_id, repo_path, source,
       mode, workspace_kind, user_visible, status, created_at, updated_at)
     VALUES (:id, :short, 't', 'codex', 'codex', 'r', '/tmp/r', 'ui',
       'read_only', 'in_place', 1, 'running', :now, :now)`,
    { id, short: id.slice(0, 8), now },
  );
}

describe('EventStore', () => {
  let dir: string;
  let db: Db;
  let bus: EventBus;
  let store: EventStore;
  let published: HubEventEnvelope[];
  /** 广播时库里已经有这一条（先落库后广播）。 */
  let persistedAtPublish: boolean[];
  const T = 'aaaaaaaa-0000-0000-0000-000000000001';
  const U = 'bbbbbbbb-0000-0000-0000-000000000002';

  beforeEach(() => {
    jest.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'ah-es-'));
    db = new Db(join(dir, 'hub.db'));
    migrate(db);
    insertTask(db, T);
    insertTask(db, U);
    bus = new EventBus();
    store = new EventStore(db, bus);
    published = [];
    persistedAtPublish = [];
    bus.subscribeAllEvents((env) => {
      published.push(env);
      persistedAtPublish.push(store.list(env.taskId, env.seq - 1, 1)[0]?.seq === env.seq);
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const delta = (text: string, itemId = 'm1') => ({ type: 'message.delta' as const, itemId, text });
  const notice = (message: string) => ({
    type: 'notice' as const,
    level: 'info' as const,
    message,
  });

  it('非增量事件立即落库并广播；seq 从 1 连续，各任务独立', () => {
    store.append(T, null, notice('a'));
    store.append(U, null, notice('b'));
    store.append(T, null, notice('c'));
    expect(published.map((e) => [e.taskId, e.seq])).toEqual([
      [T, 1],
      [U, 1],
      [T, 2],
    ]);
    expect(persistedAtPublish).toEqual([true, true, true]);
  });

  it('增量缓冲：同一 item 合并，200 ms 后一次落库（末尾扣留窗口之外的部分）', () => {
    const words = 'hello world '.repeat(20);
    store.append(T, 'turn', delta(words.slice(0, 100)));
    store.append(T, 'turn', delta(words.slice(100)));
    expect(published).toHaveLength(0);
    jest.advanceTimersByTime(DELTA_FLUSH_MS - 1);
    expect(published).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(published).toHaveLength(1);
    const first = (published[0]!.event as { text: string }).text;
    expect(words.startsWith(first)).toBe(true);
    expect(words.length - first.length).toBeGreaterThanOrEqual(HOLDBACK_CHARS);
    expect(persistedAtPublish).toEqual([true]);
    store.append(T, 'turn', { type: 'message.completed', itemId: 'm1', text: words });
    expect(published.map((e) => e.event.type)).toEqual([
      'message.delta',
      'message.delta',
      'message.completed',
    ]);
    expect(
      published
        .slice(0, 2)
        .map((e) => (e.event as { text: string }).text)
        .join(''),
    ).toBe(words);
  });

  it('不同 item 不合并，顺序保留', () => {
    store.append(T, null, delta('a', 'm1'));
    store.append(T, null, delta('b', 'm2'));
    store.append(T, null, delta('c', 'm1'));
    store.flush(T, 'all');
    expect(published.map((e) => e.event)).toEqual([
      delta('a', 'm1'),
      delta('b', 'm2'),
      delta('c', 'm1'),
    ]);
  });

  it('攒够 16 KB 立即落库，不等计时器', () => {
    store.append(T, null, delta('x '.repeat(DELTA_FLUSH_BYTES / 2)));
    expect(published).toHaveLength(1);
  });

  it('非增量事件写入前先 flush 缓冲；这一路的结束事件（completed）先放出扣住的尾巴', () => {
    store.append(T, null, delta('a'));
    store.append(T, null, notice('n'));
    // 'a' 不到扣留窗口，notice 不结束 m1，仍扣着。
    expect(published.map((e) => [e.seq, e.event.type])).toEqual([[1, 'notice']]);
    store.append(T, null, { type: 'message.completed', itemId: 'm1', text: 'a' });
    expect(published.map((e) => [e.seq, e.event.type])).toEqual([
      [1, 'notice'],
      [2, 'message.delta'],
      [3, 'message.completed'],
    ]);
  });

  it('flushAll 写出所有任务的缓冲', () => {
    store.append(T, null, delta('a'));
    store.append(U, null, delta('b'));
    store.flushAll();
    expect(published.map((e) => e.taskId).sort()).toEqual([T, U].sort());
    jest.advanceTimersByTime(DELTA_FLUSH_MS * 2);
    expect(published).toHaveLength(2); // 计时器已清掉，不会重复写
  });

  it('工具输出单个 item 上限 1 MB：越界时记一条 truncated，之后丢弃；forgetTask 清掉计数', () => {
    const out = (text: string, itemId = 'cmd') => ({
      type: 'tool.output.delta' as const,
      itemId,
      text,
    });
    const chunk = 'y'.repeat(256 * 1024);
    for (let i = 0; i < 4; i++) store.append(T, null, out(chunk)); // 正好 1 MB
    store.append(T, null, out('z')); // 越界
    store.append(T, null, out('more')); // 已截断：丢弃
    store.append(T, null, out('other', 'cmd2')); // 另一个 item 不受影响
    store.flush(T, 'all');
    const tool = published
      .filter((e) => e.event.type === 'tool.output.delta')
      .map((e) => e.event as { itemId: string; text: string; truncated?: boolean });
    const bytes = tool.filter((e) => e.itemId === 'cmd').reduce((n, e) => n + e.text.length, 0);
    expect(bytes).toBe(TOOL_OUTPUT_CAP_BYTES);
    expect(tool.filter((e) => e.truncated)).toEqual([
      { type: 'tool.output.delta', itemId: 'cmd', text: '', truncated: true },
    ]);
    expect(tool.some((e) => e.text.includes('more'))).toBe(false);
    expect(tool.find((e) => e.itemId === 'cmd2')?.text).toBe('other');

    store.forgetTask(T);
    store.append(T, null, out('again'));
    store.flush(T, 'all');
    expect((published.at(-1)!.event as { text: string }).text).toBe('again');
  });

  it('list 按 seq 升序分页', () => {
    for (let i = 0; i < 5; i++) store.append(T, null, notice(String(i)));
    expect(store.list(T, 0, 2).map((e) => e.seq)).toEqual([1, 2]);
    expect(store.list(T, 2, 10).map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  describe('尾部扣留（审查 6040751657）', () => {
    const body = 'K8'.repeat(20);
    const line = `noise ${'w '.repeat(40)}OPENAI_API_KEY=${['sk', body].join('-')}\nnext line\n`;
    const out = (text: string, itemId = 'cmd') => ({
      type: 'tool.output.delta' as const,
      itemId,
      text,
    });
    const texts = () => published.map((e) => (e.event as { text?: string }).text ?? '');

    it('密钥切在任意位置、两块之间过了 200 ms：每条事件单独脱敏后都没有密钥片段', () => {
      for (let p = 0; p <= line.length; p++) {
        published.length = 0;
        store.append(T, 't', out(line.slice(0, p)));
        jest.advanceTimersByTime(DELTA_FLUSH_MS);
        store.append(T, 't', out(line.slice(p)));
        jest.advanceTimersByTime(DELTA_FLUSH_MS);
        store.append(T, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
        const deltas = published.filter((e) => e.event.type === 'tool.output.delta');
        expect(deltas.map((e) => (e.event as { text: string }).text).join('')).toBe(line);
        for (const e of deltas) {
          const red = redact((e.event as { text: string }).text);
          for (let i = 0; i + 8 <= body.length; i++)
            expect(red).not.toContain(body.slice(i, i + 8));
        }
        const seqs = published.map((e) => e.seq);
        expect(seqs).toEqual(seqs.map((_, i) => seqs[0]! + i));
      }
    });

    it('turn.completed 放出本任务所有输出流扣住的尾巴，在它之前落库', () => {
      store.append(T, 't', out('tail-a', 'c1'));
      store.append(T, 't', delta('tail-b', 'm9'));
      store.append(U, 't', delta('other-task', 'm9'));
      store.flush(T);
      expect(published).toHaveLength(0);
      store.append(T, 't', {
        type: 'turn.completed',
        turnId: 't',
        index: 0,
        status: 'completed',
        stopReason: 'end_turn',
      });
      expect(published.map((e) => [e.taskId, e.event.type])).toEqual([
        [T, 'tool.output.delta'],
        [T, 'message.delta'],
        [T, 'turn.completed'],
      ]);
      expect(texts().slice(0, 2)).toEqual(['tail-a', 'tail-b']);
      store.flushAll();
      expect(published.at(-1)!.taskId).toBe(U);
    });

    it('截断标记之前先放出这一路扣住的尾巴', () => {
      store.append(T, 't', out('x'.repeat(TOOL_OUTPUT_CAP_BYTES - 10) + ' last'));
      store.append(T, 't', out('y'.repeat(100)));
      store.flush(T);
      const evs = published.map((e) => e.event as { text: string; truncated?: true });
      expect(evs.at(-1)).toEqual({
        type: 'tool.output.delta',
        itemId: 'cmd',
        text: '',
        truncated: true,
      });
      expect(
        evs
          .slice(0, -1)
          .map((e) => e.text)
          .join(''),
      ).toBe('x'.repeat(TOOL_OUTPUT_CAP_BYTES - 10) + ' last');
    });
  });
});
