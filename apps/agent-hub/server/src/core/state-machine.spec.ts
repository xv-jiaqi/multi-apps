import { TASK_STATUSES } from '@agent-hub/contract';
import { canTransition, TRANSITIONS } from './state-machine';

describe('StateMachine（architecture.md §3.1 穷举）', () => {
  const allowed = new Set(
    Object.entries(TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`)),
  );
  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      it(`${from} -> ${to}`, () => {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}->${to}`));
      });
    }
  }
  it('表与文档一致', () => {
    expect(allowed.size).toBe(14);
  });
});
