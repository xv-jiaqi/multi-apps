import { describe, expect, it } from 'vitest';
import { resolvePostAuthRedirect } from './auth-redirect';

describe('resolvePostAuthRedirect', () => {
  it('accepts a direct string redirect target', () => {
    expect(resolvePostAuthRedirect('/trade/new?cardSlug=aurora-knight')).toBe(
      '/trade/new?cardSlug=aurora-knight',
    );
  });

  it('accepts string state wrapped in a from object', () => {
    expect(resolvePostAuthRedirect({ from: '/forum/new' })).toBe('/forum/new');
  });

  it('reconstructs pathname + search + hash when given a location-like object', () => {
    expect(
      resolvePostAuthRedirect({
        from: { pathname: '/reports', search: '?status=PENDING', hash: '#latest' },
      }),
    ).toBe('/reports?status=PENDING#latest');
  });

  it('rejects newlines, carriage returns, and nulls in a string target', () => {
    expect(resolvePostAuthRedirect(`/${'\n'}/evil.example`)).toBe('/');
    expect(resolvePostAuthRedirect(`/${'\r'}/evil.example`)).toBe('/');
    expect(resolvePostAuthRedirect(`/${'\0'}/evil.example`)).toBe('/');
  });

  it('rejects a control character in pathname, search, or hash', () => {
    expect(
      resolvePostAuthRedirect({
        from: { pathname: `/${'\n'}/evil.example`, search: '', hash: '' },
      }),
    ).toBe('/');
    expect(
      resolvePostAuthRedirect({
        from: { pathname: '/cards', search: `?${'\r'}q=1`, hash: '' },
      }),
    ).toBe('/');
    expect(
      resolvePostAuthRedirect({
        from: { pathname: '/cards', search: '', hash: `#${'\0'}c1` },
      }),
    ).toBe('/');
  });

  it('keeps a same-site card path with unicode, search, and hash', () => {
    expect(resolvePostAuthRedirect('/cards/极光骑士?tab=comments#c1')).toBe(
      '/cards/极光骑士?tab=comments#c1',
    );
  });

  it('rejects protocol-relative paths and URLs with a scheme', () => {
    expect(resolvePostAuthRedirect({ from: '//evil.example/phish' })).toBe('/');
    expect(resolvePostAuthRedirect({ from: 'https://evil.example/phish' })).toBe('/');
    expect(resolvePostAuthRedirect('javascript:alert(1)')).toBe('/');
    expect(resolvePostAuthRedirect({ from: '/\\evil.example/phish' })).toBe('/');
    expect(
      resolvePostAuthRedirect({
        from: { pathname: '//evil.example', search: '', hash: '' },
      }),
    ).toBe('/');
  });

  it('rejects a tab that browsers collapse into a protocol-relative path', () => {
    const hidden = `/${'\t'}/evil.example`;
    expect(resolvePostAuthRedirect(hidden)).toBe('/');
    expect(resolvePostAuthRedirect({ from: hidden })).toBe('/');
  });

  it('decodes the target before checking and keeps a plain same-site path', () => {
    expect(resolvePostAuthRedirect('/%09/evil.com')).toBe('/');
    expect(resolvePostAuthRedirect({ from: '/%09/evil.com' })).toBe('/');
    expect(
      resolvePostAuthRedirect({
        from: { pathname: '/%09/evil.com', search: '', hash: '' },
      }),
    ).toBe('/');
    expect(resolvePostAuthRedirect('/%0a/evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/%0d/evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/%00/evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('//evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/\\evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('https://evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/%2509/evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/%2F/evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/%252F/evil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/%5Cevil.com')).toBe('/');
    expect(resolvePostAuthRedirect('/%E0%A4%A')).toBe('/');
    expect(resolvePostAuthRedirect('/cards/1?x=1#y')).toBe('/cards/1?x=1#y');
  });

  it('returns encoded query values unchanged when every decoded layer is same-site', () => {
    expect(resolvePostAuthRedirect('/trade?card=a%26b&kind=sell')).toBe(
      '/trade?card=a%26b&kind=sell',
    );
    expect(resolvePostAuthRedirect('/trade?card=foo%23bar')).toBe('/trade?card=foo%23bar');
    expect(resolvePostAuthRedirect('/trade?card=100%25')).toBe('/trade?card=100%25');
    expect(resolvePostAuthRedirect('/trade?card=a%2Bb')).toBe('/trade?card=a%2Bb');
  });
});
