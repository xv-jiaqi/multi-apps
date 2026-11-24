import { observer } from 'mobx-react-lite';
import Taro, { useDidShow } from '@tarojs/taro';
import { Button, ScrollView, Text, View } from '@tarojs/components';
import { t } from '@repo/shared';
import { applyTabBarLabels } from '../../lib/apply-tab-bar-labels';
import { useStores } from '../../stores/root-store';
import './index.scss';

/**
 * CH-301 §1 「我的」: sign-in state only. Signed in shows the username and
 * sign-out; signed out shows sign-in and sign-up. No language switch,
 * favourites, notifications, or password change.
 */
export default observer(function MePage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  useDidShow(() => {
    applyTabBarLabels();
    void Taro.setNavigationBarTitle({ title: tt('tab.me') });
  });

  const user = session.isAuthenticated ? session.user : null;

  return (
    <ScrollView scrollY className="me-page">
      <View className="me-page__body">
        <Text className="me-page__title">{tt('tab.me')}</Text>
        <View className="me-page__card">
          {user ? (
            <View>
              <Text className="me-page__user">
                {tt('miniapp.home.profile', { username: user.username })}
              </Text>
              <Button
                className="me-page__button me-page__button--secondary"
                onClick={() => {
                  session.signOut();
                  void Taro.showToast({ title: tt('miniapp.toast.logoutOk'), icon: 'success' });
                }}
              >
                {tt('miniapp.home.logout')}
              </Button>
            </View>
          ) : (
            <View>
              <Button
                className="me-page__button me-page__button--primary"
                onClick={() => void Taro.navigateTo({ url: '/pages/auth/login/index' })}
              >
                {tt('nav.login')}
              </Button>
              <Button
                className="me-page__button me-page__button--secondary"
                onClick={() => void Taro.navigateTo({ url: '/pages/auth/register/index' })}
              >
                {tt('nav.register')}
              </Button>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
});
