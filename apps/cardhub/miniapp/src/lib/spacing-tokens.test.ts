import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const SPACING_PROPS =
  /((?:margin|padding)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?|gap|row-gap|column-gap|border-radius|border-(?:top|bottom|left|right)(?:-left|-right)?-radius)\s*:\s*([^;{]+);/g;
const BARE_RPX = /-?\d*\.?\d+rpx/;
const RADIUS_PROP = /^border(?:-(?:top|bottom|left|right)(?:-left|-right)?)?-radius$/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'evidence') continue;
      walk(full, acc);
    } else if (name.endsWith('.scss')) {
      acc.push(full);
    }
  }
  return acc;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('spacing and radius tokens (CH-301 v1.3)', () => {
  it('miniapp SCSS uses only $spacing-* / $radius-* for margin, padding, gap and radius', () => {
    const failures: string[] = [];
    for (const file of walk(srcDir)) {
      const rel = path.relative(srcDir, file);
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        SPACING_PROPS.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = SPACING_PROPS.exec(line))) {
          const prop = match[1];
          const value = match[2];
          if (!prop || !value || !BARE_RPX.test(value)) continue;
          const kind = RADIUS_PROP.test(prop) ? '$radius-*' : '$spacing-*';
          failures.push(`${rel}:${i + 1}: ${prop}: ${value.trim()} (use ${kind})`);
        }
      });
    }
    expect(failures).toEqual([]);
  });
});
