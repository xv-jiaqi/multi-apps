import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

describe('forum reads carry surface: miniapp (CH-301 §2 / content-security)', () => {
  it('list, detail and reply load-more pass surface in the query input', () => {
    const list = readFileSync(path.join(srcDir, 'pages/forum/list/index.tsx'), 'utf8');
    const detail = readFileSync(path.join(srcDir, 'pages/forum/detail/index.tsx'), 'utf8');
    expect(list).toMatch(/trpc\.forum\.topics\.list\.query\(\{[\s\S]*surface:\s*'miniapp'/);
    expect(detail).toMatch(/trpc\.forum\.topics\.bySlug\.query\(\{[\s\S]*surface:\s*'miniapp'/);
    expect(detail).toMatch(/trpc\.forum\.replies\.list\.query\(\{[\s\S]*surface:\s*'miniapp'/);
  });
});
