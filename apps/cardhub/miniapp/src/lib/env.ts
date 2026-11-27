import Taro from '@tarojs/taro';

/** True on Taro H5 and in jsdom tests where getEnv is missing or WEB. */
export function isWebEnv(): boolean {
  const env = typeof Taro.getEnv === 'function' ? String(Taro.getEnv()) : '';
  return env === '' || env === 'WEB';
}
