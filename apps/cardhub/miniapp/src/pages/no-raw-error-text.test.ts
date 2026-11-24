import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CH-301 §6: no page shows `e.message`, a status code, or zod text. Pages
 * read errors only through `src/lib/load-error.ts`, which drops the message.
 */
const pagesDir = path.dirname(new URL(import.meta.url).pathname);

function pageSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageSources(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

describe('miniapp pages', () => {
  it('never render an error message or stringified error', () => {
    const offenders = pageSources(pagesDir).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [/\b(e|err|error)\.message\b/, /String\(e\)/, /String\(err(or)?\)/]
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path.relative(pagesDir, file)} matches ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it('never fall back to an em dash for stats', () => {
    const home = readFileSync(path.join(pagesDir, 'index/index.tsx'), 'utf8');
    expect(home).not.toContain("'—'");
  });
});
