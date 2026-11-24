/**
 * Stub for unit tests: the real @tarojs/taro pulls in @tarojs/runtime, which
 * needs build-time globals. Tests that care about a call mock this module.
 */
const noop = async () => undefined;
const Taro = {
  showToast: noop,
  showActionSheet: noop,
  setNavigationBarTitle: noop,
  navigateTo: noop,
  redirectTo: noop,
  switchTab: noop,
  navigateBack: noop,
  getCurrentPages: () => [] as unknown[],
  pxTransform: (size: number) => `${size}px`,
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined,
  request: noop,
};
export function useRouter() {
  return { params: {} as Record<string, string | undefined> };
}
export function useDidShow(_cb: () => void) {}

export default Taro;
