import { mentionUsernames } from './mentions';

describe('mentionUsernames', () => {
  it('reads plain-text names and ignores email-shaped text', () => {
    expect(mentionUsernames('hi @alice, (@bob) and a@cara.com')).toEqual(['alice', 'bob']);
    expect(mentionUsernames('@ab')).toEqual([]);
    expect(mentionUsernames('_@alice -@bob 1@cara')).toEqual(['bob']);
    expect(mentionUsernames('@Alice @alice')).toEqual(['Alice', 'alice']);
    expect(mentionUsernames('@alice @alice @bob')).toEqual(['alice', 'bob']);
  });

  it('skips fenced blocks, indented code, and inline code', () => {
    const fenced = [
      'before @keep',
      '```js',
      '@hidden',
      '~~~',
      'still @inside',
      '```',
      '@after',
    ].join('\n');
    expect(mentionUsernames(fenced)).toEqual(['keep', 'after']);

    const tilde = ['~~~', '@hidden', '~~~', '@shown'].join('\n');
    expect(mentionUsernames(tilde)).toEqual(['shown']);

    expect(mentionUsernames('say `@hidden` and @shown')).toEqual(['shown']);
    expect(mentionUsernames('`` code ` @hidden `` end @shown')).toEqual(['shown']);
    expect(mentionUsernames('    @hidden\n\t@also\n @shown')).toEqual(['shown']);
    expect(mentionUsernames('unclosed ` @shown')).toEqual(['shown']);
  });

  it('keeps the first 10 distinct names and drops the rest', () => {
    const names = Array.from({ length: 12 }, (_, index) => `user${index + 10}`);
    const body = names.map((name) => `@${name}`).join(' ');
    expect(mentionUsernames(body)).toEqual(names.slice(0, 10));
    expect(mentionUsernames(body, 3)).toEqual(names.slice(0, 3));
  });
});
