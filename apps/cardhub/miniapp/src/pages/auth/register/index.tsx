import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro from '@tarojs/taro';
import { ScrollView, View, Text } from '@tarojs/components';
import { BreadcrumbsMini, Field, Link, PrimaryButton, SectionCard } from '@repo/ui-mini';
import { registerInput, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';

export default observer(function RegisterPage() {
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    const parsed = registerInput.safeParse({ email, username, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? tt('auth.errors.required'));
      return;
    }
    setSubmitting(true);
    try {
      const { token, user } = await trpc.auth.register.mutate(parsed.data);
      session.signIn(token, { id: user.id, username: user.username, role: user.role });
      void Taro.showToast({ title: tt('miniapp.toast.registerOk'), icon: 'success' });
      void Taro.redirectTo({ url: '/pages/index/index' });
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
            { label: tt('auth.register.title') },
          ]}
        />

        <SectionCard title={tt('auth.register.title')}>
          <Text style={{ fontSize: '26rpx', color: '#525252' }}>
            {tt('auth.register.subtitle')}
          </Text>
          <View style={{ height: '24rpx' }} />

          <Field
            label={tt('auth.fields.email')}
            value={email}
            onInput={setEmail}
            placeholder="alice@cardhub.test"
            maxlength={128}
          />
          <Field
            label={tt('auth.fields.username')}
            value={username}
            onInput={setUsername}
            placeholder="alice"
            maxlength={24}
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
            label={submitting ? tt('auth.actions.submitting') : tt('auth.actions.register')}
            disabled={submitting}
            onClick={submit}
          />

          <View style={{ height: '16rpx' }} />
          <Link to="/pages/auth/login/index">
            <Text style={{ color: '#2563eb', fontSize: '24rpx', textAlign: 'center' }}>
              {tt('auth.actions.toLogin')}
            </Text>
          </Link>
        </SectionCard>
      </View>
    </ScrollView>
  );
});
