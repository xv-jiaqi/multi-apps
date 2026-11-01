import { describe, expect, it } from 'vitest';
import { addCalendarDays, shanghaiToday } from './shanghai-date';

describe('Asia/Shanghai calendar dates', () => {
  it('uses the Shanghai calendar day, not the browser zone', () => {
    expect(shanghaiToday(new Date('2026-10-31T15:30:00.000Z'))).toBe('2026-10-31');
    expect(shanghaiToday(new Date('2026-10-31T16:30:00.000Z'))).toBe('2026-11-01');
    expect(shanghaiToday(new Date('2026-11-01T00:30:00.000Z'))).toBe('2026-11-01');
  });

  it('adds calendar days without shifting the civil date', () => {
    expect(addCalendarDays('2026-11-01', 365)).toBe('2027-11-01');
    expect(addCalendarDays('2024-02-29', 365)).toBe('2025-02-28');
    expect(addCalendarDays('2026-01-01', 0)).toBe('2026-01-01');
  });
});
