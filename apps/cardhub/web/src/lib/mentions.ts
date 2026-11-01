export type MentionPart = { kind: 'text'; value: string } | { kind: 'mention'; value: string };

/**
 * Spec §0-9 / §8. The character before `@` cannot be a letter, digit, or
 * underscore, so `a@b.com` is not a mention. Names shorter than 3 are not
 * mentions. Case is preserved.
 */
const MENTION = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_-]{3,})/g;

export function splitPlainMentions(source: string): MentionPart[] {
  const pattern = new RegExp(MENTION.source, 'g');
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const prefix = match[1] ?? '';
    const name = match[2];
    if (!name) continue;
    const before = source.slice(last, index);
    if (before) parts.push({ kind: 'text', value: before });
    if (prefix) parts.push({ kind: 'text', value: prefix });
    parts.push({ kind: 'mention', value: `@${name}` });
    last = index + match[0].length;
  }
  const rest = source.slice(last);
  if (rest) parts.push({ kind: 'text', value: rest });
  if (parts.length === 0) parts.push({ kind: 'text', value: source });
  return parts;
}
