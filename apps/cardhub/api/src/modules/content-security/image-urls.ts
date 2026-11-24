const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\((https:\/\/[^)\s]+)\)/gi;
const IMAGE_FILE_RE = /https:\/\/[^\s"'<>)]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s"'<>)]*)?/gi;

export function extractHttpsImageUrls(args: {
  texts?: readonly string[];
  imageUrls?: readonly string[];
}): string[] {
  const found = new Set<string>();
  for (const url of args.imageUrls ?? []) {
    const trimmed = url.trim();
    if (trimmed.toLowerCase().startsWith('https://')) found.add(trimmed);
  }
  for (const text of args.texts ?? []) {
    for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
      const url = match[1]?.trim();
      if (url) found.add(url);
    }
    for (const match of text.matchAll(IMAGE_FILE_RE)) {
      found.add(match[0]);
    }
  }
  return [...found];
}

export function excerptOf(texts: readonly string[], max = 120): string {
  const joined = texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n');
  if (joined.length <= max) return joined;
  return joined.slice(0, max);
}

export const MSG_SEC_CHECK_MAX_CHARS = 2500;

export function splitTextForMsgSecCheck(text: string): string[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += MSG_SEC_CHECK_MAX_CHARS) {
    chunks.push(chars.slice(i, i + MSG_SEC_CHECK_MAX_CHARS).join(''));
  }
  return chunks;
}

export type TextSuggest = 'pass' | 'review' | 'risky';

export function worstTextSuggest(results: readonly TextSuggest[]): TextSuggest {
  if (results.includes('risky')) return 'risky';
  if (results.includes('review')) return 'review';
  return 'pass';
}
