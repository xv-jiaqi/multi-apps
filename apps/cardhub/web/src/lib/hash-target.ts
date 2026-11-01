const HASH_TARGET =
  /^#(reply|comment)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export type HashTarget = { kind: 'reply' | 'comment'; id: string };

const PARENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comment-reply links add this query only when the parent id is a uuid. */
export function readParentId(search: string): string | null {
  const value = new URLSearchParams(search).get('parentId');
  if (!value || !PARENT_ID.test(value)) return null;
  return value;
}

export function parseHashTarget(hash: string): HashTarget | null {
  const match = HASH_TARGET.exec(hash);
  const kind = match?.[1];
  const id = match?.[2];
  if ((kind !== 'reply' && kind !== 'comment') || !id) return null;
  return { kind, id };
}

/** `#reply-…` / `#comment-…` whose id is not a uuid. Other hashes are ignored. */
export function illegalHashTarget(hash: string): boolean {
  if (parseHashTarget(hash)) return false;
  return /^#(reply|comment)-.+$/i.test(hash);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function revealElement(node: HTMLElement): void {
  node.scrollIntoView?.({
    block: 'center',
    behavior: reducedMotion() ? 'auto' : 'smooth',
  });
  node.focus({ preventScroll: true });
}
