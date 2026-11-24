import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../../');

describe('ui-mini Field label color (CH-301 §5 v1.4)', () => {
  it('uses a class plus $color-neutral-600, not an inline hex or the old gray', () => {
    const field = readFileSync(
      path.join(repoRoot, 'packages/ui-mini/src/components/field.tsx'),
      'utf8',
    );
    const appScss = readFileSync(path.join(repoRoot, 'apps/cardhub/miniapp/src/app.scss'), 'utf8');
    expect(field).toMatch(/className=["']ui-mini-field__label["']/);
    expect(field).not.toMatch(/#6b7280/);
    expect(field).not.toMatch(/color:\s*['"]#525252['"]/);
    expect(appScss).toMatch(/\.ui-mini-field__label[\s\S]*\$color-neutral-600/);
  });
});
