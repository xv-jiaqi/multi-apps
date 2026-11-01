import { describe, expect, it } from 'vitest';
import { MarkReadBatch } from './mark-read-batch';

describe('MarkReadBatch', () => {
  it('keeps the first snapshot and reverts only the failed row while another mark runs', () => {
    const batch = new MarkReadBatch<string>();
    batch.begin('a', 'before-a');
    batch.begin('b', 'before-b');
    expect(batch.snapshot()).toBe('before-a');
    expect(batch.settle('a', true, false)).toBe('revert');
    expect(batch.settle('b', true, false)).toBe('refetch');
    expect(batch.snapshot()).toBe('before-a');
  });

  it('ignores a late result after mark-all and does not record it', () => {
    const batch = new MarkReadBatch<string>();
    batch.begin('a', 'before');
    expect(batch.settle('a', true, true)).toBe('ignore');
    expect(batch.settle('a', false, false)).toBe('idle');
  });

  it('drops the snapshot when the wave succeeds or mark-all resets it', () => {
    const batch = new MarkReadBatch<string>();
    batch.begin('a', 'before');
    expect(batch.settle('a', false, false)).toBe('idle');
    expect(batch.snapshot()).toBeNull();

    batch.begin('b', 'next');
    batch.clear();
    expect(batch.snapshot()).toBeNull();
    batch.begin('c', 'after-clear');
    expect(batch.snapshot()).toBe('after-clear');
    expect(batch.settle('c', true, false)).toBe('refetch');
    batch.finish();
    expect(batch.snapshot()).toBeNull();
  });
});
