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
  MAX_TASK_HOLD_CHARS,
  TOOL_OUTPUT_CAP_BYTES,
} from './event-store';
import { redact } from '../common/redact';
import { HOLDBACK_CHARS, MAX_HOLD_CHARS } from './secret-holdback';

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

    it('截断标记之前先放出这一路扣住的尾巴；截断点前的未完成词一起丢掉', () => {
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
      ).toBe('x'.repeat(TOOL_OUTPUT_CAP_BYTES - 10) + ' '); // 截断点前连续非空白整段丢掉（审查 6042585463）
    });
  });

  describe('PR3（审查 6041423500 第 3、4 条，PR3 待办 4）', () => {
    const out = (text: string, itemId = 'cmd') => ({
      type: 'tool.output.delta' as const,
      itemId,
      text,
    });
    const toolText = (itemId = 'cmd') =>
      published
        .map((e) => e.event as { type: string; itemId?: string; text?: string })
        .filter((e) => e.type === 'tool.output.delta' && e.itemId === itemId)
        .map((e) => e.text)
        .join('');

    it('越过 1 MB 的那一块截到正好剩余的额度，再记 truncated', () => {
      store.append(T, null, out('y'.repeat(TOOL_OUTPUT_CAP_BYTES - 12) + ' '));
      store.append(T, null, out('abcdefghij ' + 'klmno'));
      store.flush(T, 'all');
      expect(Buffer.byteLength(toolText(), 'utf8')).toBe(TOOL_OUTPUT_CAP_BYTES);
      expect(toolText().endsWith(' abcdefghij ')).toBe(true);
      expect(published.at(-1)!.event).toMatchObject({ truncated: true });
    });

    it('截断不切开 UTF-8 字符与代理对', () => {
      store.append(T, null, out('y'.repeat(TOOL_OUTPUT_CAP_BYTES - 5) + ' ', 'a'));
      store.append(T, null, out('中 中', 'a')); // 每个 3 字节，剩余 4 字节正好放下「中 」
      store.append(T, null, out('y'.repeat(TOOL_OUTPUT_CAP_BYTES - 6) + ' ', 'b'));
      store.append(T, null, out('😀 😀', 'b')); // 每个 4 字节（2 个 UTF-16 单元），剩余 5 字节正好放下「😀 」
      store.flush(T, 'all');
      expect(toolText('a').endsWith(' 中 ')).toBe(true);
      expect(Buffer.byteLength(toolText('a'), 'utf8')).toBe(TOOL_OUTPUT_CAP_BYTES);
      expect(toolText('b').endsWith(' 😀 ')).toBe(true);
      expect(toolText('b')).not.toMatch(/[\uD800-\uDBFF]$/);
    });

    it('截断点落在密钥中间时退到密钥前，不留下半个密钥', () => {
      const key = 'sk-' + 'A1b2C3d4E5'.repeat(4);
      store.append(T, null, out('y'.repeat(TOOL_OUTPUT_CAP_BYTES - 20) + ' '));
      store.append(T, null, out(`${key} tail`));
      store.flush(T, 'all');
      expect(toolText().endsWith(' ')).toBe(true);
      expect(toolText()).not.toContain('sk-');
      expect(published.at(-1)!.event).toMatchObject({ truncated: true });
    });

    it("flush(taskId, 'text') 放出消息与推理扣住的尾巴，工具输出照旧扣着", () => {
      const tail = '请确认是否执行：rm -rf build';
      store.append(T, null, { type: 'message.delta', itemId: 'm1', text: tail });
      store.append(T, null, { type: 'reasoning.delta', itemId: 'r1', text: 'thinking about it' });
      store.append(T, null, out('partial-output-without-newline'));
      store.flush(T);
      store.flush(T, 'text');
      const texts = published.map((e) => e.event as { type: string; text?: string });
      expect(
        texts
          .filter((e) => e.type === 'message.delta')
          .map((e) => e.text)
          .join(''),
      ).toBe(tail);
      expect(
        texts
          .filter((e) => e.type === 'reasoning.delta')
          .map((e) => e.text)
          .join(''),
      ).toBe('thinking about it');
      expect(toolText()).toBe('');
      store.flush(T, 'all');
      expect(toolText()).toBe('partial-output-without-newline');
    });

    it('一个任务扣住的合计超过上限时，从最久没更新的那一路强切放出前段，短尾继续扣着', () => {
      const per = MAX_HOLD_CHARS - 1024; // 无空白，单路整段扣住
      const n = Math.floor((1024 * 1024) / per) + 3;
      for (let i = 0; i < n; i++) {
        store.append(T, null, out(String.fromCharCode(97 + (i % 26)).repeat(per), `cmd${i}`));
        store.flush(T);
      }
      const released = published
        .map((e) => e.event as { itemId: string; text: string })
        .filter((e) => e.text);
      // 合计上限之内：最旧的几路用强切放出安全前段（审查 6042585463），短尾 64 字符继续扣着。
      expect(released.map((e) => e.itemId)).toEqual(['cmd0', 'cmd1', 'cmd2']);
      expect(released.every((e) => e.text.length === per - HOLDBACK_CHARS)).toBe(true);
      store.flush(T, 'all');
      const byItem = new Map<string, string>();
      for (const e of published) {
        const ev = e.event as { itemId?: string; text?: string };
        if (ev.itemId && ev.text) byItem.set(ev.itemId, (byItem.get(ev.itemId) ?? '') + ev.text);
      }
      expect(byItem.size).toBe(n);
      for (let i = 0; i < n; i++)
        expect(byItem.get(`cmd${i}`)).toBe(String.fromCharCode(97 + (i % 26)).repeat(per));
      expect(MAX_TASK_HOLD_CHARS).toBe(1024 * 1024);
    });
  });

  describe('PR3（审查 6042585463：截断与总上限放出不得切开密钥）', () => {
    const out = (text: string, itemId = 'cmd') => ({
      type: 'tool.output.delta' as const,
      itemId,
      text,
    });
    const textsOf = (itemId = 'cmd') =>
      published
        .filter((e) => {
          const ev = e.event as { type: string; itemId?: string };
          return ev.type === 'tool.output.delta' && ev.itemId === itemId;
        })
        .map((e) => (e.event as { text?: string }).text ?? '');
    const noFragment = (body: string) => {
      for (const env of published) {
        const text = (env.event as { text?: string }).text;
        if (!text) continue;
        const red = redact(text);
        for (let i = 0; i + 8 <= body.length; i++) {
          const frag = body.slice(i, i + 8);
          const at = red.indexOf(frag);
          if (at >= 0) {
            const ev = env.event as { type: string; itemId?: string };
            // 失败时只打印片段附近，避免把 1 MB 输出写进日志。
            throw new Error(
              `seq=${env.seq} ${ev.type}${ev.itemId ? ' ' + ev.itemId : ''} 含片段 ${JSON.stringify(frag)}：…${red.slice(Math.max(0, at - 24), at + 24)}…`,
            );
          }
        }
      }
    };

    it('token 跨两块且 1 MB 截断点落在 token 中间：前半段不以明文落库', () => {
      // 复现审查 6042585463 第 1 条：先输出 1 MiB-193 字节，下一块是 `y y …`
      // 加上 ahu_ token 的前 44 个字符，再下一块是最后 3 个字符。
      const body = 'Qw9'.repeat(14) + 'Q'; // 43
      const token = `ahu_${body}`;
      expect(token).toHaveLength(47);
      const pad = 'y '.repeat(75); // 150
      store.append(T, null, out('x'.repeat(TOOL_OUTPUT_CAP_BYTES - 193)));
      store.append(T, null, out(pad + token.slice(0, 44)));
      store.append(T, null, out(token.slice(44)));
      store.flush(T, 'all');
      expect(textsOf().join('')).not.toContain('ahu_');
      noFragment(body);
      expect(published.some((e) => 'truncated' in e.event && e.event.truncated)).toBe(true);
    });

    it('超过扣留总上限时最旧一路只放安全前段，续写半个密钥不会切成两条明文', () => {
      // 复现审查 6042585463 第 2 条：A 先输出不完整的 sk- 前缀；17 路各扣 64000
      // 无空白字符触发总上限；再续写 A 的后半段。
      const body = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
      const prefix = 'env: OPENAI=sk-ABCDEFGHIJ';
      const suffix = 'KLMNOPQRSTUVWXYZ0123456789abcd done';
      store.append(T, null, out(prefix, 'A'));
      store.flush(T);
      expect(published.filter((e) => (e.event as { itemId?: string }).itemId === 'A')).toHaveLength(
        0,
      );
      for (let i = 0; i < 17; i++) {
        store.append(T, null, out('z'.repeat(64_000), `cmd${i}`));
        store.flush(T);
      }
      store.append(T, null, out(suffix, 'A'));
      store.flush(T, 'all');
      noFragment(body);
      expect(textsOf('A').join('')).toBe(prefix + suffix);
    });

    it('随机切块、截断、总量上限和结束：每条落库事件脱敏后都没有密钥的 8 字符片段', () => {
      // 固定种子，失败可复现。覆盖四种放出：普通切块 + 结束、1 MB 截断、总上限、两者交错。
      let s = 6042585463 >>> 0;
      const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const cases: Array<{ secret: string; body: string }> = [
        { secret: `ahu_${'Qw9'.repeat(14)}Q`, body: `${'Qw9'.repeat(14)}Q` },
        { secret: `sk-${'Ab3'.repeat(14)}`, body: 'Ab3'.repeat(14) },
        { secret: `gho_${'Zq9'.repeat(9)}`, body: 'Zq9'.repeat(9) },
      ];
      const nextTask = (n: number) => {
        const id = `${String(n).padStart(8, '0')}-cccc-0000-0000-000000000000`;
        insertTask(db, id);
        return id;
      };
      for (let trial = 0; trial < 24; trial++) {
        published.length = 0;
        const task = nextTask(trial);
        const { secret, body } = cases[trial % cases.length]!;
        const kind = trial % 3;
        if (kind === 0) {
          const line = `noise ${'w '.repeat(8)}KEY=${secret} end\n`;
          const cuts = Array.from({ length: 1 + Math.floor(r() * 6) }, () =>
            Math.floor(r() * (line.length + 1)),
          ).sort((a, b) => a - b);
          let prev = 0;
          for (const c of [...cuts, line.length]) {
            if (c === prev) continue;
            store.append(task, 't', out(line.slice(prev, c)));
            if (r() < 0.5) store.flush(task);
            prev = c;
          }
          store.append(task, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
          expect(textsOf().join('')).toBe(line);
        } else if (kind === 1) {
          const keep = 80 + Math.floor(r() * 120);
          const split = 1 + Math.floor(r() * (secret.length - 2));
          const pad = 'y '.repeat(Math.ceil(keep / 2)).slice(0, Math.max(0, keep - split));
          store.append(task, null, out('x'.repeat(TOOL_OUTPUT_CAP_BYTES - keep)));
          store.append(task, null, out(pad + secret.slice(0, split)));
          store.append(task, null, out(secret.slice(split) + ' tail'));
          store.flush(task, 'all');
        } else {
          const split = 1 + Math.floor(r() * (secret.length - 2));
          store.append(task, null, out(`env: KEY=${secret.slice(0, split)}`, 'A'));
          store.flush(task);
          const n = 17;
          for (let i = 0; i < n; i++) {
            store.append(task, null, out('z'.repeat(64_000), `cmd${i}`));
            store.flush(task);
          }
          store.append(task, null, out(`${secret.slice(split)} done`, 'A'));
          store.flush(task, 'all');
          expect(textsOf('A').join('')).toBe(`env: KEY=${secret} done`);
        }
        noFragment(body);
        store.forgetTask(task);
      }
    });
  });
});
