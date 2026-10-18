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

  it('rejects protocol-relative paths and URLs with a scheme', () => {
    expect(resolvePostAuthRedirect({ from: '//evil.example/phish' })).toBe('/');
    expect(resolvePostAuthRedirect({ from: 'https://evil.example/phish' })).toBe('/');
    expect(resolvePostAuthRedirect('javascript:alert(1)')).toBe('/');
    expect(
      resolvePostAuthRedirect({
        from: { pathname: '//evil.example', search: '', hash: '' },
      }),
    ).toBe('/');
  });
});
