import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  it('configures jitless before API schemas are created', async () => {
    const main = readFileSync(join(__dirname, '../src/main.ts'), 'utf8');
    const configAt = main.indexOf("import './configure-zod'");
    const initAt = main.indexOf('Sentry.init(');
    const appAt = main.indexOf("from './bootstrap/create-app'");
    expect(configAt).toBeGreaterThan(initAt);
    expect(configAt).toBeLessThan(appAt);

    const proof = beginJitlessProof();
    try {
      await import('../src/configure-zod');
      const { validateEnv } = await import('../src/config/env.validation');
      const { z } = await import('zod');
      expect(z.config().jitless).toBe(true);
      expect(validateEnv({ NODE_ENV: 'test' })).toMatchObject({
        NODE_ENV: 'test',
        PASSWORD_PREHASH_WRITE: false,
      });
      expect(proof.calls).toEqual([]);
    } finally {
      proof.restore();
    }
  });
});
