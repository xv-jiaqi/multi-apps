import { describe, expect, it } from 'vitest';
import { parseHashTarget } from './hash-target';

const ID = '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5';

describe('parseHashTarget', () => {
  it('reads a reply or comment anchor and ignores anything else', () => {
    expect(parseHashTarget(`#reply-${ID}`)).toEqual({ kind: 'reply', id: ID });
    expect(parseHashTarget(`#comment-${ID}`)).toEqual({ kind: 'comment', id: ID });
    expect(parseHashTarget('#reply-not-a-uuid')).toBeNull();
    expect(parseHashTarget('#top')).toBeNull();
  });
});
