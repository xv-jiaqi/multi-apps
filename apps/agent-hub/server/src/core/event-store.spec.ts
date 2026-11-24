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
    // 每块以换行结尾：截断点前是空白，正好落库 1 MB（无空白长行的情况见审查 6042967785 那一组）。
    const chunk = `${'y'.repeat(256 * 1024 - 1)}\n`;
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

    it('一个任务扣住的合计超过上限、各路都切不出安全前段时，从扣得最多的一路开始整路丢弃', () => {
      const per = MAX_HOLD_CHARS - 1024; // 无空白，单路整段扣住，force 也切不出安全前段
      const n = Math.floor((1024 * 1024) / per) + 3;
      store.append(T, null, out('short tail', 'small')); // 扣得少的一路不受影响
      store.flush(T);
      for (let i = 0; i < n; i++) {
        store.append(T, null, out(String.fromCharCode(97 + (i % 26)).repeat(per), `cmd${i}`));
        store.flush(T);
      }
      const evs = published.map(
        (e) =>
          e.event as {
            type: string;
            itemId?: string;
            text?: string;
            truncated?: true;
            code?: string;
          },
      );
      // 被丢弃的几路：正文一个字都不落库，只有 truncated 标记和 OUTPUT_OMITTED 提示（审查 6042967785）。
      const sealed = evs.filter((e) => e.truncated).map((e) => e.itemId);
      expect(sealed.length).toBeGreaterThan(0);
      expect(evs.filter((e) => e.code === 'OUTPUT_OMITTED')).toHaveLength(sealed.length);
      expect(evs.every((e) => !e.text)).toBe(true);
      // 之后这几路再来的输出也丢掉。
      for (const id of sealed) store.append(T, null, out('more', id!));
      store.flush(T, 'all');
      const texts = new Map<string, string>();
      for (const e of published) {
        const ev = e.event as { itemId?: string; text?: string };
        if (ev.itemId && ev.text) texts.set(ev.itemId, (texts.get(ev.itemId) ?? '') + ev.text);
      }
      for (const id of sealed) expect(texts.has(id!)).toBe(false);
      expect(texts.get('small')).toBe('short tail');
      expect(texts.size).toBe(n + 1 - sealed.length);
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

  describe('PR3（审查 6042967785：无空白长行截断、未成形长密钥、拼接、顺序）', () => {
    const out = (text: string, itemId = 'cmd') => ({
      type: 'tool.output.delta' as const,
      itemId,
      text,
    });
    type Ev = { type: string; itemId?: string; text?: string; truncated?: true };
    /** 同一路（事件类型 + itemId）落库的增量，按 seq 排好。 */
    const streams = () => {
      const m = new Map<string, HubEventEnvelope[]>();
      for (const env of published) {
        const ev = env.event as Ev;
        if (!ev.type.endsWith('.delta') || !ev.itemId) continue;
        const key = `${ev.type}/${ev.itemId}`;
        m.set(key, [...(m.get(key) ?? []), env]);
      }
      return m;
    };
    /**
     * 桥接方能拿到的东西：每条单独脱敏；再把同一路相邻的（以及整路）脱敏结果拼起来。
     * 两种都不能出现密钥正文的任何 8 字符片段（审查 6042967785：seq 23 + seq 25 拼出完整 JWT）。
     */
    const assertNoLeak = (body: string, label = '') => {
      const frags = Array.from({ length: Math.max(0, body.length - 7) }, (_, i) =>
        body.slice(i, i + 8),
      );
      const hit = (s: string) => frags.find((f) => s.includes(f));
      for (const [key, envs] of streams()) {
        const reds = envs.map((e) => redact((e.event as Ev).text ?? ''));
        for (let i = 0; i < reds.length; i++) {
          const one = hit(reds[i]!);
          if (one)
            throw new Error(
              `${label} ${key} seq=${envs[i]!.seq} 单条含片段 ${JSON.stringify(one)}`,
            );
          if (i + 1 < reds.length) {
            const two = hit(reds[i]! + reds[i + 1]!);
            if (two)
              throw new Error(
                `${label} ${key} seq=${envs[i]!.seq}+${envs[i + 1]!.seq} 拼接后含片段 ${JSON.stringify(two)}`,
              );
          }
        }
        const all = hit(reds.join(''));
        if (all) throw new Error(`${label} ${key} 整路拼接后含片段 ${JSON.stringify(all)}`);
      }
    };
    const textOf = (itemId: string) =>
      (streams().get(`tool.output.delta/${itemId}`) ?? [])
        .map((e) => (e.event as Ev).text ?? '')
        .join('');

    it('复现 1：1 MiB 无空白文本后，跨块的 ahu_ token 被截断点切开，前缀不落库', () => {
      const body = `${'Qw9'.repeat(14)}Q`;
      const token = `ahu_${body}`;
      store.append(T, null, out('a'.repeat(TOOL_OUTPUT_CAP_BYTES - 300)));
      store.append(T, null, out(`${'b'.repeat(270)}"${token.slice(0, 41)}`));
      store.append(T, null, out(`${token.slice(41)}" done`));
      store.flush(T, 'all');
      expect(textOf('cmd')).not.toContain('ahu_');
      assertNoLeak(body);
      expect(published.some((e) => (e.event as Ev).truncated)).toBe(true);
    });

    it('复现 2：超总上限时扣着 90 字符未成形的 JWT，不被切成两条明文', () => {
      const sig = 'S1g'.repeat(10);
      const jwt = `eyJ${'hHh'.repeat(6)}.${'pPp'.repeat(30)}.${sig}`;
      const body = jwt.slice(3);
      store.append(T, null, out(`X=${jwt.slice(0, 90)}`, 'A'));
      store.flush(T);
      for (let i = 0; i < 17; i++) {
        store.append(T, null, out('z'.repeat(64_000), `cmd${i}`));
        store.flush(T);
      }
      store.append(T, null, out(`${jwt.slice(90)} done`, 'A'));
      store.flush(T, 'all');
      assertNoLeak(body);
    });

    it('截断时原位替换：同一缓冲里别的 item 的落库顺序不变', () => {
      store.append(T, 't', out('x'.repeat(TOOL_OUTPUT_CAP_BYTES - 200) + ' '));
      jest.advanceTimersByTime(DELTA_FLUSH_MS);
      store.append(T, 't', out('first part of the tail '));
      store.append(T, 't', delta('message after the tool chunk ', 'm1'));
      store.append(T, 't', out('y '.repeat(200)));
      store.flush(T, 'all');
      const seqOf = (pred: (e: Ev) => boolean) =>
        published.find((env) => pred(env.event as Ev))?.seq ?? -1;
      const tail = seqOf((e) => e.type === 'tool.output.delta' && !!e.text?.includes('first part'));
      const msg = seqOf((e) => e.type === 'message.delta');
      const marker = seqOf((e) => !!e.truncated);
      expect(tail).toBeGreaterThan(0);
      // 工具这一块在消息之前到达，落库也要在消息之前；截断标记在最后。
      expect(msg).toBeGreaterThan(tail);
      expect(marker).toBeGreaterThan(msg);
    });

    it('复现 3：continue 下超过 64 KiB 的无空白长行，没写完的长 JWT 跨在强切点上，不被切开', () => {
      const jwt = `eyJ${'Hh1'.repeat(10)}.${'Pp2'.repeat(60)}.${'S1g'.repeat(20)}`;
      const body = jwt.slice(3);
      const pre = `{"blob":"${'c'.repeat(MAX_HOLD_CHARS + 500)}","jwt":"`;
      store.append(T, 't', out(pre + jwt.slice(0, 150)));
      store.flush(T);
      store.append(T, 't', out(`${jwt.slice(150)}"} done\n`));
      store.append(T, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
      assertNoLeak(body);
    });

    it('continue 下切不出安全前段、尾巴又超过 64 KiB：整路丢弃并打 OUTPUT_OMITTED / truncated 标记', () => {
      const body = 'A'.repeat(MAX_HOLD_CHARS + 10);
      store.append(T, 't', out(`ok "eyJ${body.slice(0, 40_000)}`));
      store.flush(T);
      store.append(T, 't', out(`${body.slice(40_000)}`));
      store.flush(T);
      store.append(T, 't', out('.more" done\n'));
      store.append(T, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
      expect(textOf('cmd')).toBe('ok "');
      const evs = published.map(
        (e) => e.event as { type: string; code?: string; truncated?: boolean },
      );
      expect(evs.some((e) => e.type === 'notice' && e.code === 'OUTPUT_OMITTED')).toBe(true);
      expect(evs.some((e) => e.type === 'tool.output.delta' && e.truncated === true)).toBe(true);
      expect(JSON.stringify(published)).not.toContain('AAAAAAAA');
    });

    it('同一批里被 seal 的一路，后面交错进来的同路增量也丢掉，不当成新的一路放出', () => {
      store.append(T, 't', out('ok "eyJ'));
      for (let i = 0; i < 4; i++) {
        store.append(T, 't', out('A'.repeat(15_000)));
        store.flush(T);
      }
      store.append(T, 't', out('A'.repeat(6000)));
      store.append(T, 't', out('other ', 'cmd2'));
      store.append(T, 't', out(`${'A'.repeat(5000)}.sigsigsig" done\n`));
      store.flush(T);
      store.append(T, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
      expect(textOf('cmd')).toBe('ok "');
      expect(JSON.stringify(published)).not.toContain('AAAAAAAA');
      expect(JSON.stringify(published)).not.toContain('sigsig');
    });

    it('没闭合的私钥块（head -c 400 id_rsa）：输出结束时从 BEGIN 打码到文末', () => {
      const body = Array.from({ length: 5 }, () => 'Kq7'.repeat(21) + 'K').join('\n');
      store.append(T, 't', out('$ head -c 400 id_rsa\n-----BEGIN RSA PRIVATE KEY-----\n'));
      store.flush(T);
      store.append(T, 't', out(body.slice(0, 200)));
      store.flush(T);
      store.append(T, 't', out(body.slice(200)));
      store.append(T, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
      assertNoLeak(body);
    });

    it('紧贴字母数字的 URL 凭据（xhttps://u:p@h）跨块也打码', () => {
      const pw = 'Pw8'.repeat(30);
      const url = `xhttps://deploy:${pw}@git.example.com/r.git`;
      store.append(T, 't', out(`clone ${url.slice(0, 40)}`));
      store.flush(T);
      store.append(T, 't', out(`${url.slice(40)} ok\n`));
      store.append(T, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
      assertNoLeak(pw);
    });

    it('随机性质（v2）：无空白长度、密钥长度、切点都随机；单条与同路拼接都没有密钥片段', () => {
      let s = 6042967785 >>> 0;
      const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
      const pick = <X>(xs: X[]) => xs[int(0, xs.length - 1)]!;
      const rep = (u: string, n: number) => u.repeat(Math.ceil(n / u.length)).slice(0, n);
      /** [完整写法, 必须消失的正文]，长度随机。 */
      const genSecret = (): [string, string] => {
        switch (int(0, 9)) {
          case 0: {
            const b = `${rep('Qw9', 42)}Q`;
            return [`ahu_${b}`, b];
          }
          case 1: {
            const b = rep('Ab3', int(20, 120));
            return [`sk-${b}`, b];
          }
          case 2: {
            const b = rep('Zq9', int(20, 90));
            return [`gho_${b}`, b];
          }
          case 3: {
            const b = rep('QW3RTY7UIOP2ASDF', 16);
            return [`AKIA${b}`, b];
          }
          case 4: {
            const b = `${rep('Hh1', int(8, 60))}.${rep('Pp2', int(8, 200))}.${rep('Sg3', int(8, 80))}`;
            return [`eyJ${b}`, b];
          }
          case 6: {
            // 没闭合的私钥块（head -c N id_rsa）：没有 END，正文必须从 BEGIN 打码到这一路结束。
            const lines = Array.from({ length: int(1, 8) }, () => rep('Kq7', 21) + 'K');
            const b = lines.join('\n').slice(0, int(20, lines.length * 65));
            return [`-----BEGIN ${pick(['RSA ', 'OPENSSH ', 'EC ', ''])}PRIVATE KEY-----\n${b}`, b];
          }
          case 7: {
            // 紧贴字母数字的 URL 凭据（xhttps://u:p@h），不能依赖 \b。
            const b = rep('Pw8', int(10, 120));
            return [`x${pick(['https', 'http'])}://deploy:${b}@git.example.com/r.git`, b];
          }
          case 8: {
            // 紧贴字母数字的令牌（abcghp_…、xxxeyJ…）：开头不要求 \b。
            const glue = pick(['abc', 'x', 'key', 'Z9', 'tok_']);
            const [prefix, b] = pick<[string, string]>([
              ['ahu_', `${rep('Qw9', 42)}Q`],
              ['github_pat_', rep('Ab3', int(20, 120))],
              ['ghp_', rep('Zq9', int(20, 90))],
              ['xoxb-', rep('12ab', int(10, 60))],
              ['AKIA', rep('QW3RTY7UIOP2ASDF', 16)],
              [
                'eyJ',
                `${rep('Hh1', int(8, 60))}.${rep('Pp2', int(8, 200))}.${rep('Sg3', int(8, 80))}`,
              ],
            ]);
            return [`${glue}${prefix}${b}`, b];
          }
          case 9: {
            // URL 编码之后的 sk-（key%3Dsk-…）：前面是 %XX，也要打码。
            const b = rep('Ab3', int(20, 120));
            return [`key%3Dsk-${b}`, b];
          }
          default: {
            const b = rep('Pw8', int(10, 120));
            return [`https://deploy:${b}@git.example.com/r.git`, b];
          }
        }
      };
      let n = 0;
      const nextTask = () => {
        const id = `${String(++n).padStart(8, '0')}-dddd-0000-0000-000000000000`;
        insertTask(db, id);
        return id;
      };
      for (let trial = 0; trial < 90; trial++) {
        published.length = 0;
        const task = nextTask();
        const [secret, body] = genSecret();
        const kind = trial % 3;
        const label = `trial=${trial} kind=${kind} len=${secret.length}`;
        if (kind === 0) {
          // 截断：前面整段无空白（长度随机，可能是整个 1 MiB），截断点落在跨块的密钥里。
          const room = int(1, Math.min(400, secret.length + 60));
          // 填充以引号结尾，保证密钥前有词边界（redact 规则用 \b，紧贴字母时本来就不匹配）。
          const filler = int(0, 60);
          const split = int(1, secret.length - 1);
          const head =
            r() < 0.5
              ? 'a'.repeat(TOOL_OUTPUT_CAP_BYTES - room)
              : `${'a'.repeat(TOOL_OUTPUT_CAP_BYTES - room - 1)} `;
          store.append(task, null, out(head));
          if (r() < 0.5) store.flush(task);
          store.append(task, null, out(`${'b'.repeat(filler)}"${secret.slice(0, split)}`));
          if (r() < 0.5) store.flush(task);
          store.append(task, null, out(`${secret.slice(split)} done`));
          store.flush(task, 'all');
        } else if (kind === 1) {
          // 总上限：最旧一路扣着一段未成形的密钥（可能长于 64 字符），其他路占满上限，再续写。
          const split = int(1, secret.length - 1);
          const lead = pick(['X=', 'KEY=', '"token":"', 'env: K=', '']);
          store.append(task, null, out(`${lead}${secret.slice(0, split)}`, 'A'));
          store.flush(task);
          const ways = int(17, 20);
          for (let i = 0; i < ways; i++) {
            store.append(task, null, out('z'.repeat(int(60_000, 65_000)), `cmd${i}`));
            store.flush(task);
          }
          store.append(task, null, out(`${secret.slice(split)} done`, 'A'));
          store.flush(task, 'all');
        } else {
          // 普通增量：无空白前缀长度随机，一半超过 MAX_HOLD_CHARS（64 KiB）；长密钥可能还没写完就跨在
          // 强切点上（审查 6042967785 第 6 条）。整行随机切块、随机 flush，最后结束。
          const long = r() < 0.5;
          const pre = 'c'.repeat(
            long ? int(MAX_HOLD_CHARS + 1, MAX_HOLD_CHARS + 8000) : int(0, 3000),
          );
          const line = long
            ? `${pre}"${secret}"${'d'.repeat(int(0, 200))} tail\n`
            : `noise ${pre}${pick(['=', ' ', ':'])}${secret} tail\n`;
          const k = line.indexOf(secret);
          // 长行：至少一个切点落在密钥里，且之前没有空白可退。
          const cuts = Array.from({ length: int(1, 8) }, () => int(0, line.length));
          if (long) cuts.push(k + int(1, secret.length - 1));
          cuts.sort((a, b) => a - b);
          let prev = 0;
          for (const c of [...cuts, line.length]) {
            if (c === prev) continue;
            store.append(task, 't', out(line.slice(prev, c)));
            if (long || r() < 0.5) store.flush(task);
            prev = c;
          }
          store.append(task, 't', { type: 'tool.completed', itemId: 'cmd', status: 'completed' });
          const omitted = published.some(
            (e) => (e.event as { code?: string }).code === 'OUTPUT_OMITTED',
          );
          // 不丢的话逐字相同；整路丢弃时落库的是原文的前缀。
          if (omitted) expect(line.startsWith(textOf('cmd'))).toBe(true);
          else expect(textOf('cmd')).toBe(line);
        }
        assertNoLeak(body, label);
        store.forgetTask(task);
      }
    });
  });
});
