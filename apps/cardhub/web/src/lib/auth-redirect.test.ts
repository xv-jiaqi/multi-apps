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
});
