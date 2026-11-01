import { decodeNotificationCursor, encodeNotificationCursor } from './cursor';

describe('notification cursor', () => {
  it('round-trips the keyset and rejects a short cursor', () => {
    const createdAt = new Date('2026-11-01T00:00:00.000Z');
    const id = '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5';
    const cursor = encodeNotificationCursor(createdAt, id);
    expect(cursor).toHaveLength(32);
    expect(decodeNotificationCursor(cursor ?? '')).toEqual({ createdAt, id });
    expect(decodeNotificationCursor('not-a-cursor')).toBeNull();
    expect(encodeNotificationCursor(createdAt, 'topic-1')).toBeNull();
  });
});
