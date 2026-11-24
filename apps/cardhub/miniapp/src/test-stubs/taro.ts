/**
 * Stub for unit tests: the real @tarojs/taro pulls in @tarojs/runtime, which
 * needs build-time globals. Tests that care about a call mock this module.
 */
const noop = async () => undefined;
const ENV_TYPE = {
  WEAPP: 'WEAPP',
  SWAN: 'SWAN',
  ALIPAY: 'ALIPAY',
  TT: 'TT',
  QQ: 'QQ',
  WEB: 'WEB',
};

const Taro = {
  ENV_TYPE,
  getEnv: () => ENV_TYPE.WEB,
  login: async () => ({ errMsg: 'login:ok', code: '' }),
  useLaunch: (_cb: () => void) => undefined,
  useDidShow: (_cb: () => void) => undefined,
  showToast: noop,
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
export default Taro;
