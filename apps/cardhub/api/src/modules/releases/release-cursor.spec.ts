import { decodeReleaseCursor, encodeReleaseCursor } from './release-cursor';

const EARLY = '00000000-0000-4000-8000-00000000000a';
const LATE = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

describe('release cursor', () => {
  it('round-trips a civil date and id without looking the row up', () => {
    const cursor = encodeReleaseCursor('2026-11-06', EARLY);
    expect(cursor.length).toBeLessThanOrEqual(64);
    expect(cursor).not.toContain('2026-11-06');
    expect(cursor).not.toContain(EARLY);
    expect(decodeReleaseCursor(cursor)).toEqual({ releaseDate: '2026-11-06', id: EARLY });
  });

  it('preserves id case so the keyset comparison matches the stored text', () => {
    const cursor = encodeReleaseCursor('2026-11-06', LATE);
    expect(decodeReleaseCursor(cursor)?.id).toBe(LATE);
  });

  it('rejects malformed cursors', () => {
    expect(decodeReleaseCursor('not-a-cursor')).toBeNull();
    expect(decodeReleaseCursor(EARLY)).toBeNull();
    expect(decodeReleaseCursor('@@@')).toBeNull();
    expect(decodeReleaseCursor(`${encodeReleaseCursor('2026-11-06', EARLY)}x`)).toBeNull();
    expect(decodeReleaseCursor(encodeReleaseCursor('2026/11/06', EARLY))).toBeNull();
    expect(decodeReleaseCursor(encodeReleaseCursor('2026-02-31', EARLY))).toBeNull();
  });
});
