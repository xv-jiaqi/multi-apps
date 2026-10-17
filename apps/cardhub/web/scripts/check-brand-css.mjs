import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../../..');

const sourceRoots = [
  path.join(appRoot, 'src'),
  path.join(repoRoot, 'packages/ui-web/src'),
];
const sourceExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx']);

function walkFiles(dir, predicate) {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath, predicate);
    return predicate(fullPath) ? [fullPath] : [];
  });
}

function collectBrandClasses() {
  const classes = new Set();
  const utilityPattern = /[!A-Za-z0-9_:[\]./%#-]*brand-[A-Za-z0-9_[\]./%#-]+/g;

  for (const root of sourceRoots) {
    for (const filePath of walkFiles(root, (file) => sourceExtensions.has(path.extname(file)))) {
      const source = readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(utilityPattern)) {
        classes.add(match[0]);
      }
    }
  }

  return [...classes].sort();
}

function cssFilesFromEnv() {
  const raw = process.env.CARDHUB_BRAND_CSS_FILES;
  if (!raw) return null;
  return raw
    .split(path.delimiter)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => path.resolve(process.cwd(), file));
}

function collectCssFiles() {
  const envFiles = cssFilesFromEnv();
  if (envFiles) return envFiles;

  const assetsDir = path.join(appRoot, 'dist/assets');
  return walkFiles(assetsDir, (file) => path.extname(file) === '.css');
}

function escapeClassName(className) {
  return className.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);
}

const brandClasses = collectBrandClasses();
const cssFiles = collectCssFiles();
const requiredCssRules = [
  {
    className: 'md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]',
    declaration: 'grid-template-columns:minmax(0,18rem) minmax(0,1fr)',
    description: 'card detail responsive grid columns',
  },
];

if (brandClasses.length === 0) {
  console.error('No brand-* utilities were found in Cardhub web or shared UI source.');
  process.exit(1);
}

if (cssFiles.length === 0 || cssFiles.some((file) => !existsSync(file) || !statSync(file).isFile())) {
  console.error('No built CSS files were found. Run the Cardhub web build before this check.');
  process.exit(1);
}

const builtCss = cssFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const missing = brandClasses.filter((className) => !builtCss.includes(`.${escapeClassName(className)}`));
const missingRules = requiredCssRules.filter(({ className, declaration }) => {
  const selector = `.${escapeClassName(className)}`;
  const selectorIndex = builtCss.indexOf(selector);
  if (selectorIndex === -1) return true;

  const ruleEnd = builtCss.indexOf('}', selectorIndex);
  if (ruleEnd === -1) return true;

  return !builtCss.slice(selectorIndex, ruleEnd).includes(declaration);
});

if (missing.length > 0 || missingRules.length > 0) {
  if (missingRules.length > 0) {
    console.error('Missing required CSS rules in built CSS:');
    for (const { className, description } of missingRules) {
      console.error(`- ${description}: ${className}`);
    }
  }

  if (missing.length > 0) {
    console.error('Missing brand utilities in built CSS:');
    for (const className of missing) {
      console.error(`- ${className}`);
    }
  }
  process.exit(1);
}

console.log(`Verified ${brandClasses.length} brand utilities in built CSS:`);
for (const className of brandClasses) {
  console.log(`- ${className}`);
}
console.log(`Verified ${requiredCssRules.length} required CSS rule:`);
for (const { className, description } of requiredCssRules) {
  console.log(`- ${description}: ${className}`);
}
