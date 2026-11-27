import Taro from '@tarojs/taro';
import { rootStore } from '../stores/root-store';
import { createMiniappVisitReporter } from './create-miniapp-visit-reporter';
import { trpc } from './trpc';

function isWeapp(): boolean {
  try {
    return Taro.getEnv() === Taro.ENV_TYPE.WEAPP;
  } catch {
    return false;
  }
}

async function login(): Promise<{ code: string }> {
  const result = await Taro.login();
  const code = 'code' in result && typeof result.code === 'string' ? result.code : '';
  return { code };
}

export const miniappVisit = createMiniappVisitReporter({
  isWeapp,
  isAuthenticated: () => rootStore.session.isAuthenticated,
  userId: () => rootStore.session.user?.id ?? null,
  login,
  report: (input) => trpc.contentSecurity.recordMiniappVisit.mutate(input),
});
