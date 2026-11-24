import Taro from '@tarojs/taro';

/**
 * CH-301 §1 after sign-in or sign-up: go back to where the user came from.
 * At the bottom of the stack go to home. Home is a tab page, and WeChat
 * rejects `redirectTo` to a tab page, so this uses `switchTab`.
 */
export function leaveAuthPage(): void {
  if (Taro.getCurrentPages().length > 1) {
    void Taro.navigateBack({ delta: 1 });
    return;
  }
  void Taro.switchTab({ url: '/pages/index/index' });
}
