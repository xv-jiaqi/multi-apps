import {
  isVisibleOnSurface,
  mergeSafetyStatus,
  publicSafetyWhere,
  resolveContentSurface,
} from './visibility';

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

describe('mergeSafetyStatus', () => {
  it('keeps review and risky when a later eval returns unchecked or pass', () => {
    expect(mergeSafetyStatus('REVIEW', 'UNCHECKED')).toBe('REVIEW');
    expect(mergeSafetyStatus('REVIEW', 'PASS')).toBe('REVIEW');
    expect(mergeSafetyStatus('RISKY', 'UNCHECKED')).toBe('RISKY');
    expect(mergeSafetyStatus('RISKY', 'PASS')).toBe('RISKY');
    expect(mergeSafetyStatus('REVIEW', 'RISKY')).toBe('RISKY');
  });

  it('lets unchecked be promoted after a real pass, and pass fall back when unchecked', () => {
    expect(mergeSafetyStatus('UNCHECKED', 'PASS')).toBe('PASS');
    expect(mergeSafetyStatus('PASS', 'UNCHECKED')).toBe('UNCHECKED');
    expect(mergeSafetyStatus('PASS', 'REVIEW')).toBe('REVIEW');
    expect(mergeSafetyStatus(undefined, 'UNCHECKED')).toBe('UNCHECKED');
  });

  it('does not make a review topic web-public after an unchecked merge', () => {
    const status = mergeSafetyStatus('REVIEW', 'UNCHECKED');
    expect(
      isVisibleOnSurface({
        surface: 'web',
        status,
        authorId: 'u1',
        viewerId: 'u2',
      }),
    ).toBe(false);
  });
});
