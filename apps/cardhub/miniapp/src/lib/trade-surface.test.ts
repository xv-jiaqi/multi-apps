import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

describe('trade reads carry surface: miniapp (CH-301 §3 / content-security)', () => {
  it('list, byCard pass surface in the query input', () => {
    const list = readFileSync(path.join(srcDir, 'pages/trade/list/index.tsx'), 'utf8');
    const detail = readFileSync(path.join(srcDir, 'pages/cards/detail/index.tsx'), 'utf8');
    expect(list).toMatch(/trpc\.listings\.list\.query\(\{[\s\S]*surface:\s*'miniapp'/);
    expect(detail).toMatch(/trpc\.listings\.byCard\.query\(\{[\s\S]*surface:\s*'miniapp'/);
  });
});
