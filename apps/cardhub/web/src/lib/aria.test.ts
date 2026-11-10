import { describe, expect, it } from 'vitest';
import { describedBy } from './aria';

describe('describedBy (CH-226 §7-8 v1.4)', () => {
  it('keeps the ids a field already had and adds the restored line after them', () => {
    expect(describedBy('title-error', 'title-count', 'restored-line')).toBe(
      'title-error title-count restored-line',
    );
  });

  it('drops the restored line when it is gone, and keeps the rest', () => {
    expect(describedBy('title-error', false)).toBe('title-error');
  });

  it('is undefined when nothing describes the field', () => {
    expect(describedBy(undefined, null, false, '')).toBeUndefined();
  });
});
