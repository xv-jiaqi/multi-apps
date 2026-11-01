import { describe, expect, it } from 'vitest';
import { splitPlainMentions } from './mentions';

function mentions(source: string): string[] {
  return splitPlainMentions(source)
    .filter((part) => part.kind === 'mention')
    .map((part) => part.value);
}

describe('splitPlainMentions', () => {
  it('styles a name in the middle and keeps the original case', () => {
    expect(mentions('see @Ada_1 now')).toEqual(['@Ada_1']);
    expect(
      splitPlainMentions('see @Ada_1 now')
        .map((part) => part.value)
        .join(''),
    ).toBe('see @Ada_1 now');
  });

  it('does not treat an email or a name after a letter, digit, or underscore as a mention', () => {
    expect(mentions('mail a@b.com')).toEqual([]);
    expect(mentions('a@abcd')).toEqual([]);
    expect(mentions('1@abcd')).toEqual([]);
    expect(mentions('_@abcd')).toEqual([]);
  });

  it('ignores names shorter than 3 and still matches a name at the start or after punctuation', () => {
    expect(mentions('@ab @abc')).toEqual(['@abc']);
    expect(mentions('(@carol)')).toEqual(['@carol']);
    expect(mentions('-@dave')).toEqual(['@dave']);
  });
});
