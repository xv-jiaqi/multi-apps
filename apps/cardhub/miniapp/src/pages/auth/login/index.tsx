import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro from '@tarojs/taro';
import { ScrollView, View, Text } from '@tarojs/components';
import { BreadcrumbsMini, Field, Link, PrimaryButton, SectionCard } from '@repo/ui-mini';
import { fieldErrorMessage, loginInput, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';

export default observer(function LoginPage() {
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    const parsed = loginInput.safeParse({ identifier, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]
          ? fieldErrorMessage(locale.locale, parsed.error.issues[0].message)
          : tt('auth.errors.required'),
      );
      return;
    }
    setSubmitting(true);
    try {
      const { token, user } = await trpc.auth.login.mutate(parsed.data);
      session.signIn(token, { id: user.id, username: user.username, role: user.role });
      void Taro.showToast({ title: tt('miniapp.toast.loginOk'), icon: 'success' });
      // `navigateBack` when the user got here from the card detail page;
      // `redirectTo` home otherwise so the sign-in page isn't in the stack.
      const pages = Taro.getCurrentPages();
      if (pages.length > 1) {
        void Taro.navigateBack({ delta: 1 });
      } else {
        void Taro.redirectTo({ url: '/pages/index/index' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView scrollY style={{ height: '100vh' }}>
      <View style={{ padding: '32rpx' }}>
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index' },
            { label: tt('auth.login.title') },
          ]}
        />

        <SectionCard title={tt('auth.login.title')}>
          <Text style={{ fontSize: '26rpx', color: '#525252' }}>{tt('auth.login.subtitle')}</Text>
          <View style={{ height: '24rpx' }} />

          <Field
            label={tt('auth.fields.identifier')}
            value={identifier}
            onInput={setIdentifier}
            placeholder="alice@cardhub.test"
            maxlength={128}
          />
          <Field
            label={tt('auth.fields.password')}
            value={password}
            onInput={setPassword}
            placeholder="********"
            password
            maxlength={128}
          />

          {error ? (
            <View
              style={{
                padding: '16rpx',
                background: '#fef2f2',
                borderRadius: '12rpx',
                border: '1rpx solid #fecaca',
                marginBottom: '16rpx',
              }}
            >
              <Text style={{ color: '#b91c1c', fontSize: '24rpx' }}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={submitting ? tt('auth.actions.submitting') : tt('auth.actions.login')}
            disabled={submitting}
            onClick={submit}
          />

          <View style={{ height: '16rpx' }} />
          <Link to="/pages/auth/register/index">
            <Text style={{ color: '#2563eb', fontSize: '24rpx', textAlign: 'center' }}>
              {tt('auth.actions.toRegister')}
            </Text>
          </Link>
        </SectionCard>
      </View>
    </ScrollView>
  );
});
