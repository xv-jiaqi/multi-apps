import { t } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import {
  calendarMonthRange,
  dayHeading,
  groupCalendarReleases,
  monthHeading,
  parseCalendarMonth,
  shiftCalendarMonth,
  withinMonthLabel,
} from './calendar-month';

describe('calendar months', () => {
  it('uses the Shanghai day when the month query is missing or invalid', () => {
    expect(parseCalendarMonth(null, '2026-12-15')).toBe('2026-12');
    expect(parseCalendarMonth('nope', '2026-12-15')).toBe('2026-12');
    expect(parseCalendarMonth('2026-13', '2026-12-15')).toBe('2026-12');
    expect(parseCalendarMonth('2026-00', '2026-12-15')).toBe('2026-12');
    expect(parseCalendarMonth('2026-11', '2026-12-15')).toBe('2026-11');
  });

  it('shifts months and stops at the civil year edges', () => {
    expect(shiftCalendarMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftCalendarMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftCalendarMonth('0001-01', -1)).toBeNull();
    expect(shiftCalendarMonth('9999-12', 1)).toBeNull();
    expect(shiftCalendarMonth('0099-12', 1)).toBe('0100-01');
  });

  it('keeps years 1–99 in that century when building the query range', () => {
    expect(calendarMonthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(calendarMonthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(calendarMonthRange('0099-01')).toEqual({ from: '0099-01-01', to: '0099-01-31' });
    expect(calendarMonthRange('2026-13')).toBeNull();
  });

  it('formats month and day headings from the civil date', () => {
    expect(monthHeading('zh-CN', '2026-11')).toBe('2026年11月');
    expect(monthHeading('en-US', '2026-11')).toBe('November 2026');
    expect(withinMonthLabel('zh-CN', '2026-11')).toBe('11月内');
    expect(withinMonthLabel('en-US', '2026-11')).toBe('In November');
    expect(dayHeading('zh-CN', '2026-11-06', false, '今天')).toBe('11月6日 周五');
    expect(dayHeading('zh-CN', '2026-11-06', true, '今天')).toBe('11月6日 周五 · 今天');
    expect(dayHeading('en-US', '2026-11-06', false, 'Today')).toBe('Fri, Nov 6');
    expect(dayHeading('en-US', '2026-11-06', true, 'Today')).toBe('Fri, Nov 6 · Today');
  });

  it('announces one English release and keeps the Chinese count sentence', () => {
    expect(t('zh-CN', 'calendar.monthStatus', { month: '2026年11月', count: 1 })).toBe(
      '2026年11月，共 1 条',
    );
    expect(t('en-US', 'calendar.monthStatus', { month: 'November 2026', count: 1 })).toBe(
      'November 2026, 1 release',
    );
    expect(t('en-US', 'calendar.monthStatus', { month: 'November 2026', count: 4 })).toBe(
      'November 2026, 4 releases',
    );
  });

  it('lists every same-day release in locale order and keeps month precision out of the day', () => {
    const grouped = groupCalendarReleases(
      [
        {
          id: 'b',
          title: '乙',
          releaseDate: '2026-11-06',
          datePrecision: 'DAY' as const,
        },
        {
          id: 'a',
          title: '甲',
          releaseDate: '2026-11-06',
          datePrecision: 'DAY' as const,
        },
        {
          id: 'm',
          title: '待定',
          releaseDate: '2026-11-01',
          datePrecision: 'MONTH' as const,
        },
        {
          id: 'later',
          title: '后',
          releaseDate: '2026-11-20',
          datePrecision: 'DAY' as const,
        },
      ],
      'zh-CN',
    );
    expect(grouped.days.map((group) => group.date)).toEqual(['2026-11-06', '2026-11-20']);
    expect(grouped.days[0]?.items.map((item) => item.title)).toEqual(['甲', '乙']);
    expect(grouped.monthOnly.map((item) => item.id)).toEqual(['m']);
  });
});
