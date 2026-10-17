import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ignoredDirectories = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'prisma',
  'target',
]);
const checkedExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
]);
const arbitraryGridPattern = /(?:[!A-Za-z0-9_:/.-]+:)?grid-(?:cols|rows)-\[/g;

function walkFiles(dir) {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : walkFiles(fullPath);
    }

    return checkedExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function lineAndColumnFor(source, index) {
  const before = source.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function hasTopLevelComma(value) {
  let parenDepth = 0;

  for (const char of value) {
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === ',' && parenDepth === 0) {
      return true;
    }
  }

  return false;
}

function readArbitraryValue(source, valueStart) {
  let bracketDepth = 1;
  let index = valueStart;

  while (index < source.length && bracketDepth > 0) {
    const char = source[index];
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth -= 1;
    index += 1;
  }

  if (bracketDepth !== 0) return null;

  return {
    value: source.slice(valueStart, index - 1),
    end: index,
  };
}

const violations = [];

for (const filePath of walkFiles(repoRoot)) {
  const source = readFileSync(filePath, 'utf8');
  arbitraryGridPattern.lastIndex = 0;

  for (const match of source.matchAll(arbitraryGridPattern)) {
    const valueStart = match.index + match[0].length;
    const arbitraryValue = readArbitraryValue(source, valueStart);
    if (!arbitraryValue || !hasTopLevelComma(arbitraryValue.value)) continue;

    const { line, column } = lineAndColumnFor(source, match.index);
    violations.push({
      filePath: path.relative(repoRoot, filePath),
      line,
      column,
      className: source.slice(match.index, arbitraryValue.end),
    });
  }
}

if (violations.length > 0) {
  console.error(
    'Invalid Tailwind arbitrary grid templates: use underscores for column/row separators instead of top-level commas.',
  );
  for (const { filePath, line, column, className } of violations) {
    console.error(`- ${filePath}:${line}:${column} ${className}`);
  }
  process.exit(1);
}

console.info('Verified Tailwind arbitrary grid templates do not use top-level comma separators.');
