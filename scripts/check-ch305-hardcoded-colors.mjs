/**
 * CH-305 305-7: after the dark PR, renamed hard-coded color utilities must be gone,
 * and remaining palette colors must either carry a `dark:` companion or sit on the
 * intentional §G whitelist (danger solid buttons, rarity badge, card gradients).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const roots = [
  path.join(repoRoot, 'apps/cardhub/web/src'),
  path.join(repoRoot, 'packages/ui-web/src'),
];

const ignoredDirectories = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const excludedFiles = new Set([
  'gradients.ts',
  'catalog-utils.ts',
  'rarity-badge.tsx',
]);

const checkedExtensions = new Set(['.ts', '.tsx', '.css', '.js', '.jsx']);

const renamedPattern =
  /\b(bg-white|text-brand-(?:600|700)|bg-brand-50|border-brand-200|text-red-700|bg-red-(?:50|100)|border-red-(?:200|300|600)|ring-red-(?:200|600)|text-emerald-800|bg-emerald-50|(?:border|ring)-emerald-200|text-amber-800|bg-amber-50|border-amber-200|bg-neutral-950)\b/g;

const palettePattern =
  /\b(bg|text|border|ring)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-[0-9]+\b/g;

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : walkFiles(fullPath);
    }
    if (!checkedExtensions.has(path.extname(entry.name))) return [];
    if (entry.name.includes('.test.')) return [];
    if (excludedFiles.has(entry.name)) return [];
    return [fullPath];
  });
}

const renamedHits = [];
const paletteHits = [];

for (const root of roots) {
  for (const filePath of walkFiles(root)) {
    const rel = path.relative(repoRoot, filePath).split(path.sep).join('/');
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const lineNo = index + 1;
      for (const match of line.matchAll(renamedPattern)) {
        renamedHits.push(`${rel}:${lineNo}: ${match[0]}`);
      }
      if (line.includes('dark:')) return;
      for (const match of line.matchAll(palettePattern)) {
        const token = match[0];
        // Allow the solid danger buttons listed in §G.
        if (
          (rel === 'packages/ui-web/src/components/button.tsx' &&
            (token === 'bg-red-600' || token === 'hover:bg-red-700' || token.endsWith('red-600') || token.endsWith('red-700'))) ||
          (rel === 'apps/cardhub/web/src/pages/reports-list.tsx' &&
            (token === 'bg-red-600' || token === 'hover:bg-red-700' || token.endsWith('red-600') || token.endsWith('red-700')))
        ) {
          continue;
        }
        // button.tsx uses `destructive: 'bg-red-600 text-white hover:bg-red-700'`
        if (rel === 'packages/ui-web/src/components/button.tsx' && /red-60[07]/.test(token)) continue;
        paletteHits.push(`${rel}:${lineNo}: ${token}`);
      }
    });
  }
}

let failed = false;
if (renamedHits.length) {
  failed = true;
  console.error('CH-305 305-7 renamed-class grep must be empty:');
  for (const hit of renamedHits) console.error(`  ${hit}`);
}
if (paletteHits.length) {
  failed = true;
  console.error('CH-305 305-7 palette grep (no dark:) outside §G whitelist:');
  for (const hit of paletteHits) console.error(`  ${hit}`);
}
if (failed) process.exit(1);
console.info('CH-305 305-7 hardcoded-color checks passed.');
