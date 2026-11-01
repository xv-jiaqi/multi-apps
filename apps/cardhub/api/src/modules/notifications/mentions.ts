/** Distinct @usernames taken from one body. Spec §0-9. */
export const MENTION_LIMIT = 10;

const MENTION_PATTERN = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_-]{3,})/g;

/**
 * Plain-text @username scan. Fenced blocks, indented code, and inline code
 * are blanked first so a name inside them is not a mention. The match is
 * case-sensitive and keeps the first 10 distinct names in appearance order.
 */
export function mentionUsernames(source: string, limit = MENTION_LIMIT): string[] {
  const pattern = new RegExp(MENTION_PATTERN.source, 'g');
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of maskCode(source).matchAll(pattern)) {
    const name = match[2];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

function maskCode(source: string): string {
  let fence: '```' | '~~~' | null = null;
  const lines = source.split(/\r?\n/);
  const masked = lines.map((line) => {
    const trimmed = line.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      return ' '.repeat(line.length);
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fence = trimmed.startsWith('```') ? '```' : '~~~';
      return ' '.repeat(line.length);
    }
    if (/^(?: {4}|\t)/.test(line)) return ' '.repeat(line.length);
    return maskInlineCode(line);
  });
  return masked.join('\n');
}

function maskInlineCode(line: string): string {
  const chars = Array.from(line);
  const masked = chars.slice();
  let index = 0;
  while (index < chars.length) {
    if (chars[index] !== '`') {
      index += 1;
      continue;
    }
    let open = 0;
    while (index + open < chars.length && chars[index + open] === '`') open += 1;
    const closeAt = findClosingTicks(chars, index + open, open);
    if (closeAt === null) {
      index += 1;
      continue;
    }
    for (let cursor = index; cursor < closeAt + open; cursor += 1) masked[cursor] = ' ';
    index = closeAt + open;
  }
  return masked.join('');
}

function findClosingTicks(chars: string[], from: number, width: number): number | null {
  let cursor = from;
  while (cursor < chars.length) {
    if (chars[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    let run = 0;
    while (cursor + run < chars.length && chars[cursor + run] === '`') run += 1;
    if (run === width) return cursor;
    cursor += run;
  }
  return null;
}
