import Taro from '@tarojs/taro';
import { readTrpcErrorCodes } from './load-error';

export const LOGIN_PAGE = '/pages/auth/login/index';

export function goToLogin(): void {
  void Taro.navigateTo({ url: LOGIN_PAGE });
}

/** Session expired on a write: go to login and do not keep a draft. */
export function goLoginIfUnauthorized(error: unknown): boolean {
  const { code, appCode } = readTrpcErrorCodes(error);
  if (code === 'UNAUTHORIZED' || appCode === 'UNAUTHORIZED') {
    goToLogin();
    return true;
  }
  return false;
}
