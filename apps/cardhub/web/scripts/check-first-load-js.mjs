import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Spec CH-242 v1.1 42-1 limits.
const SPEC_DECODED_MAX = 1_050_000;
const SPEC_GZIP_MAX = 320_000;

// Regression ceilings from the CH-242 after-build on f8c0f21, plus a small
// margin, capped at the v1.1 42-1 limits.
// Search first-load was 970,509 / 297,932 (gzip-6); series 1,017,218 / 312,959.
const SEARCH_DECODED_MAX = 1_020_000;
const SERIES_DECODED_MAX = 1_050_000;
const SEARCH_GZIP_MAX = 315_000;
const SERIES_GZIP_MAX = 320_000;

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

function findChunks(files, prefix, skipPrefix) {
  return [...files.keys()].filter(
    (name) => name.startsWith(prefix) && (!skipPrefix || !name.startsWith(skipPrefix)),
  );
}

function htmlAssetScripts(html) {
  return [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
}

function emptyResult(failures) {
  return {
    ok: false,
    failures,
    initial: null,
    search: null,
    series: null,
    searchFiles: [],
    seriesFiles: [],
    reportPath: null,
  };
}

export function checkFirstLoadJs(distDir) {
  const reportPath = path.join(distDir, 'first-load-js.json');
  const assetsDir = path.join(distDir, 'assets');
  const htmlPath = path.join(distDir, 'index.html');
  if (!existsSync(htmlPath)) {
    return emptyResult([`Missing ${htmlPath}. Run vite build first.`]);
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
    return emptyResult([
      `index.html did not reference built JS (missing: ${missing.join(', ') || 'none'}).`,
    ]);
  }

  const failures = [];
  const searchChunks = findChunks(files, 'search-', 'search-syntax-');
  const seriesChunks = findChunks(files, 'series-detail-');
  if (searchChunks.length !== 1) {
    failures.push(
      `expected exactly one search-*.js chunk, found: ${searchChunks.join(', ') || '(none)'}`,
    );
  }
  if (seriesChunks.length !== 1) {
    failures.push(
      `expected exactly one series-detail-*.js chunk, found: ${seriesChunks.join(', ') || '(none)'}`,
    );
  }
  if (failures.length > 0) {
    return emptyResult(failures);
  }

  const searchGraph = walk([...initialNames, ...searchChunks], files);
  const seriesGraph = walk([...initialNames, ...seriesChunks], files);
  const initialGraph = walk(initialNames, files);
  const searchHasSeries = [...searchGraph].filter((name) => name.startsWith('series-detail-'));
  const seriesHasSearch = [...seriesGraph].filter(
    (name) => name.startsWith('search-') && !name.startsWith('search-syntax-'),
  );
  if (searchHasSeries.length > 0) {
    failures.push(
      `search first-load graph must not include series-detail-*.js, found: ${searchHasSeries.join(', ')}`,
    );
  }
  if (seriesHasSearch.length > 0) {
    failures.push(
      `series first-load graph must not include search-*.js, found: ${seriesHasSearch.join(', ')}`,
    );
  }

  const search = summarize(searchGraph, files);
  const series = summarize(seriesGraph, files);
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

  return {
    ok: failures.length === 0,
    failures,
    initial,
    search,
    series,
    searchFiles: [...searchGraph].sort(),
    seriesFiles: [...seriesGraph].sort(),
    reportPath,
  };
}

function isCli() {
  const self = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return self === invoked;
}

if (isCli()) {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = path.resolve(process.env.CARDHUB_WEB_DIST ?? path.join(appRoot, 'dist'));
  const result = checkFirstLoadJs(distDir);
  if (result.initial && result.search && result.series) {
    const lines = [
      'CH-242 first-load JS (Vite dist, gzip-6):',
      `  entry + preloads: ${result.initial.raw} raw, ${result.initial.gzip} gzip (${result.initial.files.length} files)`,
      `  search:           ${result.search.raw} raw, ${result.search.gzip} gzip (${result.search.files.length} files)` +
        (result.search.raw <= SPEC_DECODED_MAX && result.search.gzip <= SPEC_GZIP_MAX
          ? ''
          : `  (spec 42-1 ${SPEC_DECODED_MAX}/${SPEC_GZIP_MAX} not met)`),
      `  series:           ${result.series.raw} raw, ${result.series.gzip} gzip (${result.series.files.length} files)` +
        (result.series.raw <= SPEC_DECODED_MAX && result.series.gzip <= SPEC_GZIP_MAX
          ? ''
          : `  (spec 42-1 ${SPEC_DECODED_MAX}/${SPEC_GZIP_MAX} not met)`),
      `  search graph: ${result.searchFiles.length} files, no series-detail-*.js`,
      `  series graph: ${result.seriesFiles.length} files, no search-*.js`,
      `  report: ${result.reportPath}`,
    ];
    console.info(lines.join('\n'));
  }
  if (!result.ok) {
    console.error(result.failures.map((item) => `check-first-load-js: ${item}`).join('\n'));
    process.exit(1);
  }
}
