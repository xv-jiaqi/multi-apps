import { decodeCollectionCursor, encodeCollectionCursor } from './collection-cursor';

describe('collection cursor', () => {
  const id = '43267bfc-ad8f-43d4-9125-873be776f61a';
  const updatedAt = new Date('2026-10-29T17:00:53.350Z');

  it('round-trips the sort boundary inside the 36 character cursor cap', () => {
    const cursor = encodeCollectionCursor(updatedAt, id);
    expect(cursor.length).toBeLessThanOrEqual(36);
    expect(cursor).not.toBe(id);
    expect(decodeCollectionCursor(cursor)).toEqual({ updatedAt, id });
  });

  it('leaves a raw row id for the legacy lookup', () => {
    expect(decodeCollectionCursor(id)).toBeNull();
  });
});
