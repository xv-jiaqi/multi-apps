import { describe, expect, it } from 'vitest';

type ZodGlobal = typeof globalThis & {
  __zod_globalConfig?: { jitless?: boolean };
};

function beginJitlessProof() {
  const g = globalThis as ZodGlobal;
  g.__zod_globalConfig ??= {};
  const previous = g.__zod_globalConfig.jitless;
  g.__zod_globalConfig.jitless = false;
  const original = globalThis.Function;
  const calls: string[] = [];
  const wrapped = function (this: unknown, ...args: string[]) {
    calls.push(args.map((arg) => String(arg).slice(0, 80)).join('\n'));
    return Reflect.construct(original, args);
  } as unknown as FunctionConstructor;
  globalThis.Function = wrapped;
  return {
    calls,
    restore() {
      globalThis.Function = original;
      const config = g.__zod_globalConfig;
      if (!config) return;
      if (previous === undefined) delete config.jitless;
      else config.jitless = previous;
    },
  };
}

describe('zod jitless', () => {
  it('configures jitless before this package creates schemas', async () => {
    const proof = beginJitlessProof();
    try {
      const shared = await import('./index');
      const { z } = await import('zod');
      expect(z.config().jitless).toBe(true);
      expect(shared.loginInput.parse({ identifier: 'ada', password: 'password1' })).toEqual({
        identifier: 'ada',
        password: 'password1',
      });
      expect(proof.calls).toEqual([]);
    } finally {
      proof.restore();
    }
  });
});
