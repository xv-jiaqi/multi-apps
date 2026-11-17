import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(process.env.CARDHUB_WEB_DIST ?? path.join(appRoot, 'dist'));
const reportPath = path.join(distDir, 'first-load-js.json');

// Spec CH-242 v1.0 42-1 estimates. The check records them but does not fail
// the build when they are missed: on f8c0f21 the leftover first-load graph is
// the shell (React, Sentry, react-router, MobX, Zod, i18n, tRPC, header
// combobox), which series and search pages actually use. See the JSON report.
const SPEC_DECODED_MAX = 900_000;
const SPEC_GZIP_MAX = 260_000;

// Regression ceilings from the CH-242 after-build on f8c0f21, plus ~5%.
// Search first-load was 970,509 / 297,932 (gzip-6); series 1,017,218 / 312,959.
const SEARCH_DECODED_MAX = 1_020_000;
const SERIES_DECODED_MAX = 1_070_000;
const SEARCH_GZIP_MAX = 315_000;
const SERIES_GZIP_MAX = 330_000;

function listJs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(dir, name));
}

function gzipSize(buffer) {
  return gzipSync(buffer, { level: 6 }).length;
}

function importsOf(source, fileNames) {
  const found = new Set();
  for (const match of source.matchAll(/["'](\.\/[A-Za-z0-9_./@-]+\.js)["']/g)) {
    const name = match[1].slice(2);
    if (fileNames.has(name)) found.add(name);
  }
  return found;
}

function walk(entryNames, files) {
  const seen = new Set(entryNames);
  const stack = [...entryNames];
  while (stack.length > 0) {
    const name = stack.pop();
    const file = files.get(name);
    if (!file) continue;
    for (const imported of importsOf(file.source, files)) {
      if (!seen.has(imported)) {
        seen.add(imported);
        stack.push(imported);
      }
    }
  }
  return seen;
}

function summarize(names, files) {
  const items = [...names]
    .sort()
    .map((name) => {
      const file = files.get(name);
      return { name, raw: file.raw, gzip: file.gzip };
    });
  return {
    raw: items.reduce((sum, item) => sum + item.raw, 0),
    gzip: items.reduce((sum, item) => sum + item.gzip, 0),
    files: items,
    includesMarkdown: items.some((item) => item.name.startsWith('markdown-view-')),
  };
}

function findChunk(files, prefix, skipPrefix) {
  const matches = [...files.keys()].filter(
    (name) => name.startsWith(prefix) && (!skipPrefix || !name.startsWith(skipPrefix)),
  );
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${prefix}*.js chunk, found: ${matches.join(', ') || '(none)'}`);
  }
  return matches[0];
}

function htmlAssetScripts(html) {
  return [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
}

const assetsDir = path.join(distDir, 'assets');
const htmlPath = path.join(distDir, 'index.html');
if (!existsSync(htmlPath)) {
  console.error(`Missing ${htmlPath}. Run vite build first.`);
  process.exit(1);
}

const files = new Map();
for (const filePath of listJs(assetsDir)) {
  const buffer = readFileSync(filePath);
  const name = path.basename(filePath);
  files.set(name, {
    name,
    source: buffer.toString('utf8'),
    raw: buffer.length,
    gzip: gzipSize(buffer),
  });
}

const initialNames = htmlAssetScripts(readFileSync(htmlPath, 'utf8'));
const missing = initialNames.filter((name) => !files.has(name));
if (initialNames.length === 0 || missing.length > 0) {
  console.error(`index.html did not reference built JS (missing: ${missing.join(', ') || 'none'}).`);
  process.exit(1);
}

const searchChunk = findChunk(files, 'search-', 'search-syntax-');
const seriesChunk = findChunk(files, 'series-detail-');
const initialGraph = walk(initialNames, files);
const search = summarize(walk([...initialNames, searchChunk], files), files);
const series = summarize(walk([...initialNames, seriesChunk], files), files);
const initial = summarize(initialGraph, files);

const report = {
  spec: {
    decodedMax: SPEC_DECODED_MAX,
    gzipMax: SPEC_GZIP_MAX,
    searchMeets: search.raw <= SPEC_DECODED_MAX && search.gzip <= SPEC_GZIP_MAX,
    seriesMeets: series.raw <= SPEC_DECODED_MAX && series.gzip <= SPEC_GZIP_MAX,
  },
  initial,
  search,
  series,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  'CH-242 first-load JS (Vite dist, gzip-6):',
  `  entry + preloads: ${initial.raw} raw, ${initial.gzip} gzip (${initial.files.length} files)`,
  `  search:           ${search.raw} raw, ${search.gzip} gzip (${search.files.length} files)` +
    (report.spec.searchMeets ? '' : `  (spec 42-1 ${SPEC_DECODED_MAX}/${SPEC_GZIP_MAX} not met)`),
  `  series:           ${series.raw} raw, ${series.gzip} gzip (${series.files.length} files)` +
    (report.spec.seriesMeets ? '' : `  (spec 42-1 ${SPEC_DECODED_MAX}/${SPEC_GZIP_MAX} not met)`),
  `  report: ${reportPath}`,
];
console.info(lines.join('\n'));

const failures = [];
if (search.includesMarkdown || series.includesMarkdown) {
  failures.push('markdown-view-*.js must not be in the series or search first-load graph');
}
if (search.raw > SEARCH_DECODED_MAX || search.gzip > SEARCH_GZIP_MAX) {
  failures.push(
    `search first-load ${search.raw} raw / ${search.gzip} gzip exceeds regression ceiling ${SEARCH_DECODED_MAX} / ${SEARCH_GZIP_MAX}`,
  );
}
if (series.raw > SERIES_DECODED_MAX || series.gzip > SERIES_GZIP_MAX) {
  failures.push(
    `series first-load ${series.raw} raw / ${series.gzip} gzip exceeds regression ceiling ${SERIES_DECODED_MAX} / ${SERIES_GZIP_MAX}`,
  );
}
if (failures.length > 0) {
  console.error(failures.map((item) => `check-first-load-js: ${item}`).join('\n'));
  process.exit(1);
}
