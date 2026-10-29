import { describe, expect, it } from 'vitest';
import {
  METRICS_RANGE_MAX_DAYS,
  adminMetricsInput,
  inclusiveUtcDayCount,
  utcCalendarDate,
} from './metrics';

function dayCount(from: string, to: string): number {
  const start = utcCalendarDate(from);
  const end = utcCalendarDate(to);
  if (!start || !end) throw new Error(`invalid fixture ${from}..${to}`);
  return inclusiveUtcDayCount(start, end);
}

describe('adminMetricsInput', () => {
  it('accepts one day and a 366-day span, including a leap year', () => {
    expect(METRICS_RANGE_MAX_DAYS).toBe(366);
    expect(dayCount('2024-01-01', '2024-01-01')).toBe(1);
    expect(dayCount('2024-01-01', '2024-12-31')).toBe(366);
    expect(dayCount('2023-01-01', '2024-01-01')).toBe(366);
    expect(adminMetricsInput.safeParse({ from: '2024-01-01', to: '2024-01-01' }).success).toBe(
      true,
    );
    expect(adminMetricsInput.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(
      true,
    );
    expect(adminMetricsInput.safeParse({ from: '2024-02-29', to: '2024-02-29' }).success).toBe(
      true,
    );
    expect(adminMetricsInput.safeParse({ from: ' 2024-01-01 ', to: ' 2024-01-02 ' }).success).toBe(
      true,
    );
  });

  it('rejects an inverted range, an impossible day, and a span of 367 days', () => {
    const inverted = adminMetricsInput.safeParse({ from: '2024-02-02', to: '2024-02-01' });
    expect(inverted.success).toBe(false);
    if (!inverted.success) {
      expect(inverted.error.issues.map((issue) => issue.message)).toContain('metrics_range_order');
    }

    expect(adminMetricsInput.safeParse({ from: '2023-02-29', to: '2023-03-01' }).success).toBe(
      false,
    );
    expect(adminMetricsInput.safeParse({ from: '2024-02-31', to: '2024-03-01' }).success).toBe(
      false,
    );
    expect(dayCount('2024-01-01', '2025-01-01')).toBe(367);
    const tooLong = adminMetricsInput.safeParse({ from: '2024-01-01', to: '2025-01-01' });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues.map((issue) => issue.message)).toContain(
        'metrics_range_too_long',
      );
    }
    expect(dayCount('2023-01-01', '2024-01-02')).toBe(367);
    expect(adminMetricsInput.safeParse({ from: '2023-01-01', to: '2024-01-02' }).success).toBe(
      false,
    );
  });
});
