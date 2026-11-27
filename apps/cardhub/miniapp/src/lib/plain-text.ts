/**
 * Strip Markdown markers for mini-program topic / reply bodies (CH-301 §2)
 * while keeping newlines. `markdownToPlainText` in @repo/shared collapses
 * whitespace, so it stays the list-excerpt helper and is not used here.
 */
export function stripMarkdownKeepNewlines(markdown: string): string {
  const source = Array.from(markdown).slice(0, 20_000).join('');
  const lines: string[] = [];
  let fence: '```' | '~~~' | null = null;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fence = trimmed.startsWith('```') ? '```' : '~~~';
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;
    if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) continue;
    lines.push(line);
  }

  const plain = lines
    .join('\n')
    .replace(/!\[[^\]\n]{0,200}]\([^)\n]{0,500}\)/g, '')
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]{0,500})>/g, '$1')
    .replace(
      /<[A-Za-z][A-Za-z0-9-]*(?:\s[^>\n]{0,200})?>[^<\n]{0,1000}<\/[A-Za-z][A-Za-z0-9-]*>/g,
      '',
    )
    .replace(/<\/?[A-Za-z][^>\n]{0,200}>/g, '')
    .replace(/\[([^\]\n]{1,500})]\([^)\n]{0,500}\)/g, '$1')
    .replace(/`([^`\n]{1,500})`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/(^|[ \t])[-*+][ \t]+\[[ xX]\][ \t]+/g, '$1')
    .replace(/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/\[[ xX]\]\s+/g, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(
      /(^|[\s([{"'「『“‘（])\*([^*\s][^*\n]*?)\*(?=$|[\s)\]}.,!?;:'"，。！？、；：」』”’）])/g,
      '$1$2',
    )
    .replace(
      /(^|[\s([{"'「『“‘（])_([^_\s][^_\n]*?)_(?=$|[\s)\]}.,!?;:'"，。！？、；：」』”’）])/g,
      '$1$2',
    )
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/\|/g, ' ')
    // Keep newlines; only collapse runs of spaces/tabs on a line, and
    // collapse 3+ blank lines to one empty line.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return plain;
}
