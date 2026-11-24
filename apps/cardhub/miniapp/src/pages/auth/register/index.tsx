import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro from '@tarojs/taro';
import { ScrollView, View, Text } from '@tarojs/components';
import { BreadcrumbsMini, Field, Link, PrimaryButton, SectionCard } from '@repo/ui-mini';
import { fieldErrorMessage, registerInput, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { leaveAuthPage } from '../../../lib/leave-auth-page';
import { mutationErrorMessage } from '../../../lib/load-error';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { useStores } from '../../../stores/root-store';
import './index.scss';

export default observer(function RegisterPage() {
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setErrorNotice] = useState<Notice<{ text: string }> | null>(null);
  const setError = (text: string | null) =>
    setErrorNotice(text === null ? null : { id: nextNoticeId(), text });
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submitting || submittingRef.current) return;
    setError(null);
    const parsed = registerInput.safeParse({ email, username, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]
          ? fieldErrorMessage(locale.locale, parsed.error.issues[0].message)
          : tt('auth.errors.required'),
      );
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const { token, user } = await trpc.auth.register.mutate(parsed.data);
      session.signIn(token, { id: user.id, username: user.username, role: user.role });
      void Taro.showToast({ title: tt('miniapp.toast.registerOk'), icon: 'success' });
      leaveAuthPage();
    } catch (err) {
      setError(
        mutationErrorMessage({
          locale: locale.locale,
          error: err,
        }),
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <ScrollView scrollY className="auth-page">
      <View className="auth-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('auth.register.title') },
          ]}
        />

        <SectionCard title={tt('auth.register.title')}>
          <Text className="auth-page__subtitle">{tt('auth.register.subtitle')}</Text>

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
            <View key={error.id} className="auth-page__error" ariaRole="alert">
              <Text className="auth-page__error-text">{error.text}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={submitting ? tt('auth.actions.submitting') : tt('auth.actions.register')}
            disabled={submitting}
            onClick={submit}
          />

          <Link to="/pages/auth/login/index" mode="redirect" className="auth-page__switch">
            <Text className="auth-page__switch-text">{tt('auth.actions.toLogin')}</Text>
          </Link>
        </SectionCard>
      </View>
    </ScrollView>
  );
});
