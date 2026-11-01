import { describe, expect, it } from 'vitest';
import { illegalHashTarget, illegalParentId, parseHashTarget, readParentId } from './hash-target';

const ID = '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5';

describe('parseHashTarget', () => {
  it('reads a reply or comment anchor and ignores anything else', () => {
    expect(parseHashTarget(`#reply-${ID}`)).toEqual({ kind: 'reply', id: ID });
    expect(parseHashTarget(`#comment-${ID}`)).toEqual({ kind: 'comment', id: ID });
    expect(parseHashTarget('#reply-not-a-uuid')).toBeNull();
    expect(parseHashTarget('#top')).toBeNull();
    expect(illegalHashTarget('#reply-garbage')).toBe(true);
    expect(illegalHashTarget('#comment-garbage')).toBe(true);
    expect(illegalHashTarget(`#reply-${ID}`)).toBe(false);
    expect(illegalHashTarget('#top')).toBe(false);
  });
});

describe('readParentId', () => {
  it('keeps a uuid parent and ignores any other query value', () => {
    expect(readParentId(`?parentId=${ID}`)).toBe(ID);
    expect(readParentId('?parentId=parent')).toBeNull();
    expect(readParentId('')).toBeNull();
    expect(illegalParentId('?parentId=not-a-uuid')).toBe(true);
    expect(illegalParentId('?parentId=')).toBe(true);
    expect(illegalParentId(`?parentId=${ID}`)).toBe(false);
    expect(illegalParentId('')).toBe(false);
  });
});
