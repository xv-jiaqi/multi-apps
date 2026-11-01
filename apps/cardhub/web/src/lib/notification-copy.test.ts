import { describe, expect, it } from 'vitest';
import {
  newNotificationsLabel,
  notificationBellLabel,
  unreadBadgeText,
  unreadSummary,
} from './notification-copy';

describe('notification copy', () => {
  it('hides a zero badge, shows the number through 99, and caps at 99+', () => {
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(3)).toBe('3');
    expect(unreadBadgeText(99)).toBe('99');
    expect(unreadBadgeText(100)).toBe('99+');
  });

  it('names the bell for zero, a count, and 100 or more in both locales', () => {
    expect(notificationBellLabel('zh-CN', 0)).toBe('通知');
    expect(notificationBellLabel('zh-CN', null)).toBe('通知');
    expect(notificationBellLabel('zh-CN', 3)).toBe('通知，3 条未读');
    expect(notificationBellLabel('zh-CN', 100)).toBe('通知，99 条以上未读');
    expect(notificationBellLabel('en-US', 0)).toBe('Notifications');
    expect(notificationBellLabel('en-US', 3)).toBe('Notifications, 3 unread');
    expect(notificationBellLabel('en-US', 100)).toBe('Notifications, more than 99 unread');
  });

  it('uses English plural categories and a single Chinese form', () => {
    expect(unreadSummary('zh-CN', 0)).toBe('没有未读通知');
    expect(unreadSummary('zh-CN', 1)).toBe('1 条未读');
    expect(unreadSummary('zh-CN', 3)).toBe('3 条未读');
    expect(unreadSummary('en-US', 0)).toBe('No unread notifications');
    expect(unreadSummary('en-US', 1)).toBe('1 unread');
    expect(unreadSummary('en-US', 4)).toBe('4 unread');
    expect(newNotificationsLabel('en-US', 1)).toBe('1 new notification');
    expect(newNotificationsLabel('en-US', 2)).toBe('2 new notifications');
    expect(newNotificationsLabel('zh-CN', 2)).toBe('有 2 条新通知');
  });
});
