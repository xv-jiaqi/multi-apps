import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/taro', () => ({
  default: {
    navigateBack: vi.fn(),
    switchTab: vi.fn(),
    getCurrentPages: vi.fn(),
  },
}));

import Taro from '@tarojs/taro';
import { leaveAuthPage } from './leave-auth-page';

describe('leaveAuthPage (CH-301 §1 v1.3)', () => {
  beforeEach(() => {
    vi.mocked(Taro.navigateBack).mockReset();
    vi.mocked(Taro.switchTab).mockReset();
    vi.mocked(Taro.getCurrentPages).mockReset();
  });

  it('uses navigateBack when there is a previous page', () => {
    vi.mocked(Taro.getCurrentPages).mockReturnValue([{}, {}] as ReturnType<
      typeof Taro.getCurrentPages
    >);
    leaveAuthPage();
    expect(Taro.navigateBack).toHaveBeenCalledWith({ delta: 1 });
    expect(Taro.switchTab).not.toHaveBeenCalled();
  });

  it('uses switchTab to home at the bottom of the stack', () => {
    vi.mocked(Taro.getCurrentPages).mockReturnValue([{}] as ReturnType<
      typeof Taro.getCurrentPages
    >);
    leaveAuthPage();
    expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' });
    expect(Taro.navigateBack).not.toHaveBeenCalled();
  });
});
