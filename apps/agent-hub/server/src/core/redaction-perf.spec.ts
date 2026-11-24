/**
 * 脱敏与扣留的性能回归（#319 审查 6044795708）：1 MiB 的常见形态逐条规则、整体 redact、
 * splitForRedaction 和流式切分都要在宽松的时间内跑完。退化成平方级的实现在这些输入上要几十秒到几分钟，
 * 正常实现是几到几十毫秒，阈值取在中间（CI 机器慢几倍也不会抖）。
 *
 * 形态排在前面的是日常输出（base64、data URI、k8s secret），最后是对抗输入（每条前缀重复 1 MiB）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HubEventEnvelope } from '@agent-hub/contract';
import { REDACT_RULES, redact } from '../common/redact';
import { migrate } from '../db/migrations';
import { Db } from '../db/sqlite';
import { EventBus } from './event-bus';
import { EventStore } from './event-store';
import { splitForRedaction } from './secret-holdback';

const MiB = 1024 * 1024;
/** 单条规则、整体 redact、一次 splitForRedaction 的上限。 */
const ONE_PASS_MS = 1500;
/** 流式：1 MiB 按 4 KiB 一块追加、逐块刷出，再对每条落库事件单独 redact。 */
const STREAM_MS = 6000;

let seed = 6044795708 >>> 0;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const bytes = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(rnd() * 256)));
const fit = (s: string) =>
  s.length >= MiB ? s.slice(0, MiB) : s.repeat(Math.ceil(MiB / s.length)).slice(0, MiB);

const b64 = bytes(Math.ceil((MiB * 3) / 4))
  .toString('base64')
  .slice(0, MiB);
const jsonLines = Array.from(
  { length: 20_000 },
  (_, i) => `{"id":${i},"name":"item-${i}","ok":true}\n`,
).join('');
const SHAPES: Array<[string, string]> = [
  ['普通 base64（单行）', b64],
  ['JSON 的 base64（开头是 eyJ）', fit(Buffer.from(jsonLines).toString('base64'))],
  ['data URI', fit(`<img src="data:image/png;base64,${b64}">`)],
  [
    'k8s secret（YAML，值是 base64，含 JWT 的 base64）',
    fit(
      `apiVersion: v1\nkind: Secret\nmetadata:\n  name: demo\ntype: Opaque\ndata:\n${Array.from(
        { length: 200 },
        (_, i) =>
          `  key-${i}: ${bytes(3000).toString('base64')}\n  token-${i}: ${Buffer.from(
            `eyJhbGciOiJSUzI1NiJ9.${bytes(600).toString('base64url')}.${bytes(200).toString('base64url')}`,
          ).toString('base64')}\n`,
      ).join('')}`,
    ),
  ],
  ['base64url 长串里每 100 字符一个 eyJ', fit(`${b64.replace(/[+/=]/g, 'x').slice(0, 97)}eyJ`)],
  ['重复 ahu_', fit('ahu_')],
  ['重复 ahb_', fit('ahb_')],
  ['重复 github_pat_', fit('github_pat_')],
  ['重复 ghp_', fit('ghp_')],
  ['重复 gho_ + 字母数字', fit(`gho_${'a'.repeat(30)}`)],
  ['重复 xoxb-', fit('xoxb-')],
  ['重复 AKIA', fit('AKIA')],
  ['重复 sk-', fit('sk-')],
  ['重复 https://', fit('https://')],
  ['重复 eyJ', fit('eyJ')],
  ['重复 eyJ + 点', fit('eyJaaaa.')],
];

const time = (f: () => unknown) => {
  const t0 = Date.now();
  f();
  return Date.now() - t0;
};

describe.each(SHAPES)('1 MiB %s', (_name, text) => {
  it.each(REDACT_RULES.map((r, i) => [i, r] as const))('规则 #%i 单独跑', (_i, rule) => {
    expect(time(() => text.replace(rule.re, rule.to))).toBeLessThan(ONE_PASS_MS);
  });

  it('redact() 整体', () => {
    expect(time(() => redact(text))).toBeLessThan(ONE_PASS_MS);
  });

  it('splitForRedaction：continue 与 truncate', () => {
    expect(time(() => splitForRedaction(text, 'continue'))).toBeLessThan(ONE_PASS_MS);
    expect(time(() => splitForRedaction(text, 'truncate', text.length - 100))).toBeLessThan(
      ONE_PASS_MS,
    );
  });

  it('流式切分：4 KiB 一块追加、逐块刷出，每条落库事件单独 redact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ah-perf-'));
    const db = new Db(join(dir, 'hub.db'));
    try {
      migrate(db);
      const id = 'cccccccc-0000-0000-0000-000000000003';
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO tasks (id, short_id, title, agent_id, adapter_kind, repo_id, repo_path, source,
           mode, workspace_kind, user_visible, status, created_at, updated_at)
         VALUES (:id, :short, 't', 'codex', 'codex', 'r', '/tmp/r', 'ui',
           'read_only', 'in_place', 1, 'running', :now, :now)`,
        { id, short: id.slice(0, 8), now },
      );
      const bus = new EventBus();
      const store = new EventStore(db, bus);
      const published: HubEventEnvelope[] = [];
      bus.subscribeAllEvents((env) => published.push(env));
      const ms = time(() => {
        for (let i = 0; i < text.length; i += 4096) {
          store.append(id, 't', {
            type: 'message.delta',
            itemId: 'm',
            text: text.slice(i, i + 4096),
          });
          store.flush(id);
        }
        store.append(id, 't', { type: 'message.completed', itemId: 'm', text: '' });
        for (const env of published) {
          const ev = env.event as { text?: string };
          if (typeof ev.text === 'string') redact(ev.text);
        }
      });
      store.forgetTask(id);
      expect(ms).toBeLessThan(STREAM_MS);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
