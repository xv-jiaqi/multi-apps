import { afterEach, describe, expect, it, vi } from 'vitest';
import Taro from '@tarojs/taro';
import {
  consumeListNeedsRefresh,
  leaveToTabPage,
  markListNeedsRefresh,
  resetListRefreshFlags,
} from './list-refresh';

vi.mock('@tarojs/taro', () => {
  const Taro = {
    navigateBack: vi.fn(async () => undefined),
    switchTab: vi.fn(async () => undefined),
    getCurrentPages: vi.fn(() => []),
  };
  return { default: Taro };
});

afterEach(() => {
  resetListRefreshFlags();
  vi.mocked(Taro.navigateBack).mockReset();
  vi.mocked(Taro.switchTab).mockReset();
  vi.mocked(Taro.getCurrentPages).mockReset();
});

describe('list refresh flags', () => {
  it('consumes a marked target once', () => {
    expect(consumeListNeedsRefresh('forum')).toBe(false);
    markListNeedsRefresh('forum');
    expect(consumeListNeedsRefresh('trade')).toBe(false);
    expect(consumeListNeedsRefresh('forum')).toBe(true);
    expect(consumeListNeedsRefresh('forum')).toBe(false);
  });
});

describe('leaveToTabPage', () => {
  it('navigates back when there is a previous page', () => {
    vi.mocked(Taro.getCurrentPages).mockReturnValue([{}, {}] as ReturnType<
      typeof Taro.getCurrentPages
    >);
    leaveToTabPage('/pages/forum/list/index');
    expect(Taro.navigateBack).toHaveBeenCalledWith({ delta: 1 });
    expect(Taro.switchTab).not.toHaveBeenCalled();
  });

  it('switchTabs to the list when this is the only page', () => {
    vi.mocked(Taro.getCurrentPages).mockReturnValue([{}] as ReturnType<
      typeof Taro.getCurrentPages
    >);
    leaveToTabPage('/pages/forum/list/index');
    expect(Taro.navigateBack).not.toHaveBeenCalled();
    expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/forum/list/index' });
  });
});
