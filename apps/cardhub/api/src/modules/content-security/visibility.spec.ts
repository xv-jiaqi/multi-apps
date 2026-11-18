import { isVisibleOnSurface, publicSafetyWhere, resolveContentSurface } from './visibility';

describe('resolveContentSurface', () => {
  it('defaults omitted surface to web', () => {
    expect(resolveContentSurface(undefined)).toBe('web');
    expect(resolveContentSurface('miniapp')).toBe('miniapp');
  });
});

describe('publicSafetyWhere', () => {
  it('keeps unchecked rows on the default web surface', () => {
    expect(publicSafetyWhere({ surface: 'web' })).toEqual({
      safetyStatus: { in: ['PASS', 'UNCHECKED'] },
    });
  });

  it('hides unchecked from miniapp public reads and keeps the author review', () => {
    expect(publicSafetyWhere({ surface: 'miniapp', viewerId: 'u1' })).toEqual({
      OR: [{ safetyStatus: 'PASS' }, { safetyStatus: 'REVIEW', userId: 'u1' }],
    });
  });
});

describe('isVisibleOnSurface', () => {
  it('hides unchecked from miniapp even for the author', () => {
    expect(
      isVisibleOnSurface({
        surface: 'miniapp',
        status: 'UNCHECKED',
        authorId: 'u1',
        viewerId: 'u1',
      }),
    ).toBe(false);
  });

  it('shows review only to the author on every surface', () => {
    expect(
      isVisibleOnSurface({
        surface: 'web',
        status: 'REVIEW',
        authorId: 'u1',
        viewerId: 'u1',
      }),
    ).toBe(true);
    expect(
      isVisibleOnSurface({
        surface: 'web',
        status: 'REVIEW',
        authorId: 'u1',
        viewerId: 'u2',
      }),
    ).toBe(false);
  });
});
