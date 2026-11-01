const HASH_TARGET =
  /^#(reply|comment)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export type HashTarget = { kind: 'reply' | 'comment'; id: string };

export function parseHashTarget(hash: string): HashTarget | null {
  const match = HASH_TARGET.exec(hash);
  const kind = match?.[1];
  const id = match?.[2];
  if ((kind !== 'reply' && kind !== 'comment') || !id) return null;
  return { kind, id };
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function revealElement(node: HTMLElement): void {
  node.scrollIntoView({
    block: 'center',
    behavior: reducedMotion() ? 'auto' : 'smooth',
  });
  node.focus({ preventScroll: true });
}
