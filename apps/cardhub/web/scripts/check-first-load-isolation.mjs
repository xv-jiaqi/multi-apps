import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function listJs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(dir, name));
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

function findChunks(files, prefix, skipPrefix) {
  return [...files.keys()].filter(
    (name) => name.startsWith(prefix) && (!skipPrefix || !name.startsWith(skipPrefix)),
  );
}

function htmlAssetScripts(html) {
  return [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
}

function loadFiles(distDir) {
  const assetsDir = path.join(distDir, 'assets');
  const files = new Map();
  for (const filePath of listJs(assetsDir)) {
    const source = readFileSync(filePath, 'utf8');
    files.set(path.basename(filePath), { name: path.basename(filePath), source });
  }
  return files;
}

export function checkFirstLoadIsolation(distDir) {
  const htmlPath = path.join(distDir, 'index.html');
  const failures = [];
  if (!existsSync(htmlPath)) {
    return {
      ok: false,
      failures: [`Missing ${htmlPath}. Run vite build first.`],
      search: [],
      series: [],
    };
  }

  const files = loadFiles(distDir);
  const initialNames = htmlAssetScripts(readFileSync(htmlPath, 'utf8'));
  const missing = initialNames.filter((name) => !files.has(name));
  if (initialNames.length === 0 || missing.length > 0) {
    return {
      ok: false,
      failures: [
        `index.html did not reference built JS (missing: ${missing.join(', ') || 'none'}).`,
      ],
      search: [],
      series: [],
    };
  }

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
    return { ok: false, failures, search: searchChunks, series: seriesChunks };
  }

  const searchGraph = walk([...initialNames, ...searchChunks], files);
  const seriesGraph = walk([...initialNames, ...seriesChunks], files);
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

  return {
    ok: failures.length === 0,
    failures,
    search: [...searchGraph].sort(),
    series: [...seriesGraph].sort(),
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
  const result = checkFirstLoadIsolation(distDir);
  if (!result.ok) {
    console.error(result.failures.map((item) => `check-first-load-isolation: ${item}`).join('\n'));
    process.exit(1);
  }
  console.info(
    [
      'First-load page isolation (Vite dist):',
      `  search graph: ${result.search.length} files, no series-detail-*.js`,
      `  series graph: ${result.series.length} files, no search-*.js`,
    ].join('\n'),
  );
}
