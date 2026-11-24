import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFirstLoadJs } from './check-first-load-js.mjs';

const scriptPath = fileURLToPath(new URL('./check-first-load-js.mjs', import.meta.url));

function writeDist(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cardhub-first-load-js-'));
  mkdirSync(path.join(dir, 'assets'));
  for (const [relative, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, relative), contents);
  }
  return dir;
}

function isolatedPages() {
  return {
    'index.html':
      '<script type="module" src="/assets/index-aaa.js"></script>\n' +
      '<link rel="modulepreload" href="/assets/shared-bbb.js">',
    'assets/index-aaa.js': 'import "./shared-bbb.js";',
    'assets/shared-bbb.js': 'export const shell = 1;',
    'assets/search-ccc.js': 'import "./shared-bbb.js"; export const searchPage = 1;',
    'assets/series-detail-ddd.js': 'import "./shared-bbb.js"; export const seriesPage = 1;',
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const passingDir = writeDist(isolatedPages());
try {
  const passed = checkFirstLoadJs(passingDir);
  assert(passed.ok, `expected isolation to pass, got: ${passed.failures.join('; ')}`);
} finally {
  rmSync(passingDir, { recursive: true, force: true });
}

const leaking = isolatedPages();
leaking['assets/search-ccc.js'] = 'import "./series-detail-ddd.js"; export const searchPage = 1;';
const leakingDir = writeDist(leaking);
try {
  const failed = checkFirstLoadJs(leakingDir);
  assert(!failed.ok, 'expected isolation to fail when search imports series-detail');
  assert(
    failed.failures.some((item) => item.includes('series-detail-ddd.js')),
    `expected the failure to name series-detail-ddd.js, got: ${failed.failures.join('; ')}`,
  );

  const cli = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, CARDHUB_WEB_DIST: leakingDir },
    encoding: 'utf8',
  });
  assert(cli.status !== 0, 'expected the CLI to exit non-zero for a leak');
  assert(
    (cli.stderr ?? '').includes('series-detail-ddd.js'),
    `expected CLI stderr to name the leaked chunk, got: ${cli.stderr}`,
  );
  assert(
    (cli.stderr ?? '').includes('check-first-load-js:'),
    `expected CLI stderr to use the check-first-load-js prefix, got: ${cli.stderr}`,
  );
  console.info('check-first-load-js: fail-closed when search first-load includes series-detail');
  console.info(cli.stderr.trim());
} finally {
  rmSync(leakingDir, { recursive: true, force: true });
}

const reverse = isolatedPages();
reverse['assets/series-detail-ddd.js'] = 'import "./search-ccc.js"; export const seriesPage = 1;';
const reverseDir = writeDist(reverse);
try {
  const failed = checkFirstLoadJs(reverseDir);
  assert(!failed.ok, 'expected isolation to fail when series imports search');
  assert(
    failed.failures.some((item) => item.includes('search-ccc.js')),
    `expected the failure to name search-ccc.js, got: ${failed.failures.join('; ')}`,
  );
} finally {
  rmSync(reverseDir, { recursive: true, force: true });
}

console.info('check-first-load-js isolation tests passed');
