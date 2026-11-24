import {
  isVisibleOnSurface,
  mergeSafetyStatus,
  notificationTargetVisible,
  ownerSafetyWhere,
  publicSafetyWhere,
  resolveContentSurface,
  resolveSafetyView,
} from './visibility';

describe('resolveContentSurface', () => {
  it('defaults omitted surface to web', () => {
    expect(resolveContentSurface(undefined)).toBe('web');
    expect(resolveContentSurface('miniapp')).toBe('miniapp');
  });

  it('takes the stricter of input and header', () => {
    expect(resolveContentSurface(undefined, 'miniapp')).toBe('miniapp');
    expect(resolveContentSurface('web', 'miniapp')).toBe('miniapp');
    expect(resolveContentSurface('miniapp', 'web')).toBe('miniapp');
    expect(resolveContentSurface('web', 'web')).toBe('web');
    expect(resolveContentSurface(undefined, 'web')).toBe('web');
    expect(resolveContentSurface(undefined, undefined)).toBe('web');
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

describe('resolveSafetyView', () => {
  const statuses = ['UNCHECKED', 'REVIEW', 'PASS', 'RISKY'] as const;
  const surfaces = ['web', 'miniapp'] as const;
  const scopes = ['owner', 'public'] as const;

  it('never shows REVIEW or RISKY to other users or anonymous viewers', () => {
    for (const viewerId of [undefined, null, '', 'u2']) {
      for (const status of ['REVIEW', 'RISKY'] as const) {
        for (const scope of scopes) {
          for (const surface of surfaces) {
            expect(resolveSafetyView({ scope, surface, status, authorId: 'u1', viewerId })).toEqual(
              { kind: 'hidden' },
            );
          }
        }
      }
    }
  });

  it('gives the author only the blocked status for RISKY rows on miniapp', () => {
    for (const scope of scopes) {
      expect(
        resolveSafetyView({
          scope,
          surface: 'miniapp',
          status: 'RISKY',
          authorId: 'u1',
          viewerId: 'u1',
        }),
      ).toEqual({ kind: 'blocked' });
    }
  });

  it('hides the author RISKY rows on web', () => {
    for (const scope of scopes) {
      expect(
        resolveSafetyView({
          scope,
          surface: 'web',
          status: 'RISKY',
          authorId: 'u1',
          viewerId: 'u1',
        }),
      ).toEqual({ kind: 'hidden' });
    }
  });

  it('shows every non-RISKY row to its author on the owner scope', () => {
    for (const surface of surfaces) {
      for (const status of statuses.filter((value) => value !== 'RISKY')) {
        const view = resolveSafetyView({
          scope: 'owner',
          surface,
          status,
          authorId: 'u1',
          viewerId: 'u1',
        });
        expect(view.kind).toBe('visible');
      }
    }
  });

  it('matches isVisibleOnSurface for non-RISKY rows on the public scope', () => {
    for (const surface of surfaces) {
      for (const status of statuses.filter((value) => value !== 'RISKY')) {
        for (const viewerId of [undefined, 'u1', 'u2']) {
          const view = resolveSafetyView({
            scope: 'public',
            surface,
            status,
            authorId: 'u1',
            viewerId,
          });
          expect(view.kind === 'visible').toBe(
            isVisibleOnSurface({ surface, status, authorId: 'u1', viewerId }),
          );
        }
      }
    }
  });

  it('does not treat an empty viewer id as the author', () => {
    expect(
      isVisibleOnSurface({ surface: 'web', status: 'REVIEW', authorId: '', viewerId: '' }),
    ).toBe(false);
  });
});

describe('ownerSafetyWhere', () => {
  it('drops RISKY rows in the query on web only', () => {
    expect(ownerSafetyWhere({ surface: 'web' })).toEqual({ safetyStatus: { not: 'RISKY' } });
    expect(ownerSafetyWhere({ surface: 'miniapp' })).toEqual({});
  });
});

describe('notificationTargetVisible', () => {
  it.each([
    ['web', 'PASS', true],
    ['web', 'UNCHECKED', true],
    ['web', 'REVIEW', false],
    ['web', 'RISKY', false],
    ['miniapp', 'PASS', true],
    ['miniapp', 'UNCHECKED', false],
    ['miniapp', 'REVIEW', false],
    ['miniapp', 'RISKY', false],
  ] as const)(
    '%s %s -> %s (no viewer, so the author gets no exception)',
    (surface, status, expected) => {
      expect(notificationTargetVisible({ surface, status })).toBe(expected);
    },
  );
});
