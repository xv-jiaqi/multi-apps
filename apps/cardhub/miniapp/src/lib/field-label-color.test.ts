import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../../');
const field = readFileSync(
  path.join(repoRoot, 'packages/ui-mini/src/components/field.tsx'),
  'utf8',
);

describe('ui-mini Field label color (CH-301 §5 v1.4)', () => {
  it('uses $color-neutral-600 #525252, not the old gray', () => {
    expect(field).toMatch(/color:\s*'#525252'/);
    expect(field).not.toMatch(/#6b7280/);
  });
});
