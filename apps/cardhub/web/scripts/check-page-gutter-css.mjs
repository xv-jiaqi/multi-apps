import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const globalsCssPath = path.join(appRoot, 'src/styles/globals.css');

function walkFiles(dir, predicate) {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath, predicate);
    return predicate(fullPath) ? [fullPath] : [];
  });
}

function collectCssFiles() {
  const assetsDir = path.join(appRoot, 'dist/assets');
  return walkFiles(assetsDir, (file) => path.extname(file) === '.css');
}

function normalizeCss(css) {
  return css.replace(/\s+/g, '');
}

const globalsCss = readFileSync(globalsCssPath, 'utf8');
const cssFiles = collectCssFiles();

if (!globalsCss.includes('@utility app-safe-x')) {
  console.error('Expected app-safe-x to be declared with Tailwind v4 @utility.');
  process.exit(1);
}

if (
  cssFiles.length === 0 ||
  cssFiles.some((file) => !existsSync(file) || !statSync(file).isFile())
) {
  console.error('No built CSS files were found. Run the Cardhub web build before this check.');
  process.exit(1);
}

const builtCss = normalizeCss(cssFiles.map((file) => readFileSync(file, 'utf8')).join('\n'));
const appSafeXRule =
  /\.app-safe-x\{[^}]*padding-right:max\(var\(--page-gutter\),var\(--safe-area-right\)\);[^}]*padding-left:max\(var\(--page-gutter\),var\(--safe-area-left\)\);?[^}]*\}/;

if (!appSafeXRule.test(builtCss)) {
  console.error(
    'Built CSS does not contain app-safe-x with page gutter + safe-area max() padding.',
  );
  process.exit(1);
}

if (
  builtCss.includes(
    '.app-safe-x{padding-right:var(--safe-area-right);padding-left:var(--safe-area-left)}',
  )
) {
  console.error('Built CSS still contains the old zero-gutter app-safe-x rule.');
  process.exit(1);
}

console.log('Verified app-safe-x page gutter utility in built CSS.');
