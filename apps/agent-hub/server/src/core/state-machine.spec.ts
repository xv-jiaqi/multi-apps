import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_STATUSES } from '@agent-hub/contract';
import { ApiError } from '../api/api-error';
import { assertTransition, canTransition } from './state-machine';

/** architecture.md §3.1 的迁移，逐条抄成字面量（不从 TRANSITIONS 推出来）。 */
const DOC_TRANSITIONS = [
  'queued->preparing',
  'queued->cancelled',
  'preparing->running',
  'preparing->failed',
  'preparing->cancelled',
  'preparing->interrupted',
  'running->completed',
  'running->failed',
  'running->cancelled',
  'running->interrupted',
  'completed->queued',
  'failed->queued',
  'cancelled->queued',
  'interrupted->queued',
] as const;

describe('StateMachine（architecture.md §3.1 穷举）', () => {
  const allowed = new Set<string>(DOC_TRANSITIONS);

  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      const ok = allowed.has(`${from}->${to}`);
      it(`${from} -> ${to}：${ok ? '允许' : 'ILLEGAL_TRANSITION'}`, () => {
        expect(canTransition(from, to)).toBe(ok);
        if (ok) expect(() => assertTransition(from, to)).not.toThrow();
        else {
          let err: unknown;
          try {
            assertTransition(from, to);
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(ApiError);
          expect((err as ApiError).code).toBe('ILLEGAL_TRANSITION');
        }
      });
    }
  }

  it('字面量与文档里的 mermaid 图一致（文档改了这里会红）', () => {
    const doc = readFileSync(join(__dirname, '../../../docs/architecture.md'), 'utf8');
    const section = doc.slice(doc.indexOf('### 3.1 状态机'), doc.indexOf('### 3.2'));
    const edges = [...section.matchAll(/^\s+(\w+) --> (\w+):/gm)].map((m) => `${m[1]}->${m[2]}`);
    expect(edges.sort()).toEqual([...DOC_TRANSITIONS].sort());
  });
});
