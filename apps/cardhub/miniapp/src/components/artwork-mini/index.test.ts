import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname), 'index.tsx'),
  'utf8',
);

describe('ArtworkMini (CH-301 §5 / WCAG 1.1.1)', () => {
  it('hides the inner Image from assistive tech and leaves the label on the outer view', () => {
    expect(src).toMatch(/ariaHidden/);
    expect(src).toMatch(/imgProps=\{\{\s*alt:\s*['"]{2}/);
    expect(src).toMatch(/ariaRole="img"/);
    expect(src).toMatch(/ariaLabel=\{label\}/);
    // The inner Image must not also carry the label (axe would see a nameless <img> or a double name).
    const imageBlock = src.slice(
      src.indexOf('<Image'),
      src.indexOf('/>', src.indexOf('<Image')) + 2,
    );
    expect(imageBlock).not.toMatch(/ariaLabel/);
  });
});
