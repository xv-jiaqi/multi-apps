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
});
