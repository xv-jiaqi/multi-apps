import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  it('configures jitless before web schemas are created', async () => {
    const main = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');
    const imports = [...main.matchAll(/^import .+$/gm)].map((match) => match[0]);
    expect(imports[0]).toBe("import './configure-zod';");

    const proof = beginJitlessProof();
    try {
      await import('../src/configure-zod');
      const { loadLayoutPrefs } = await import('../src/lib/layout');
      const { z } = await import('zod');
      expect(z.config().jitless).toBe(true);
      const storage = {
        getItem: () => JSON.stringify({ botWidth: 360, botCollapsed: true }),
      } as unknown as Storage;
      expect(loadLayoutPrefs(storage)).toEqual({ botWidth: 360, botCollapsed: true });
      expect(proof.calls).toEqual([]);
    } finally {
      proof.restore();
    }
  });
});
