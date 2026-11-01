import { describe, expect, it } from 'vitest';
import { formatNotificationTime, formatNotificationTitle } from './relative-time';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('formatNotificationTime', () => {
  it('uses relative minutes inside a week', () => {
    const now = Date.parse('2026-05-01T00:03:00.000Z');
    const iso = '2026-05-01T00:00:00.000Z';
    expect(formatNotificationTime(iso, 'en-US', now)).toBe(
      new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }).format(-3, 'minute'),
    );
    expect(formatNotificationTime(iso, 'zh-CN', now)).toBe(
      new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(-3, 'minute'),
    );
  });

  it('keeps exactly 7 days relative and switches to a date after that', () => {
    const now = Date.parse('2026-05-08T00:00:00.000Z');
    const week = new Date(now - 7 * DAY).toISOString();
    const older = new Date(now - 7 * DAY - 1).toISOString();
    expect(formatNotificationTime(week, 'en-US', now)).toBe(
      new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }).format(-7, 'day'),
    );
    expect(formatNotificationTime(older, 'en-US', now)).toBe(
      new Date(older).toLocaleDateString('en-US', { dateStyle: 'medium' }),
    );
  });

  it('puts the full timestamp in the title', () => {
    const iso = '2026-05-01T08:30:00.000Z';
    expect(formatNotificationTitle(iso, 'zh-CN')).toBe(
      new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }),
    );
  });
});
