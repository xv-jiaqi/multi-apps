// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
vi.mock('@tarojs/taro', () => ({ useDidHide: () => undefined }));
import { useScrollRestore } from './scroll-restore';
import { forgetAllListSessions } from './list-session';

describe('useScrollRestore', () => {
  it('restores the last onScroll offset and can reset to the top', () => {
    forgetAllListSessions();
    vi.useFakeTimers();
    const { result } = renderHook(() => useScrollRestore('.trade-page', 'trade:all'));
    act(() => {
      result.current.onScroll({ detail: { scrollTop: 700 } });
    });
    act(() => {
      result.current.restore();
    });
    expect(result.current.scrollTop).toBe(700.01);
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.scrollTop).toBe(700);
    act(() => {
      result.current.reset();
    });
    expect(result.current.scrollTop).toBe(0);
    vi.useRealTimers();
  });

  it('does not apply a pending restore after reset', () => {
    forgetAllListSessions();
    vi.useFakeTimers();
    const { result } = renderHook(() => useScrollRestore('.trade-list-page', 'trade:all'));
    act(() => {
      result.current.onScroll({ detail: { scrollTop: 434 } });
      result.current.restore();
    });
    expect(result.current.scrollTop).toBe(434.01);
    act(() => {
      result.current.reset();
    });
    expect(result.current.scrollTop).toBe(0);
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.scrollTop).toBe(0);
    vi.useRealTimers();
  });

  it('does not read scroll from a still-mounted page that only shares a parent class', () => {
    forgetAllListSessions();
    vi.useFakeTimers();
    const publish = document.createElement('div');
    publish.className = 'trade-page';
    Object.defineProperty(publish, 'clientHeight', { value: 200 });
    publish.scrollTop = 434;
    document.body.appendChild(publish);
    const list = document.createElement('div');
    list.className = 'trade-page trade-list-page';
    Object.defineProperty(list, 'clientHeight', { value: 200 });
    list.scrollTop = 0;
    document.body.appendChild(list);

    const { result } = renderHook(() => useScrollRestore('.trade-list-page', 'trade:all'));
    act(() => {
      result.current.restore();
      vi.runAllTimers();
    });
    // restore() nudges a 0 offset to 0.01 so Taro reapplies it; the list stays at the top.
    expect(result.current.scrollTop).toBe(0.01);
    expect(list.scrollTop).toBe(0);
    expect(publish.scrollTop).toBe(434);

    publish.remove();
    list.remove();
    vi.useRealTimers();
  });
});
