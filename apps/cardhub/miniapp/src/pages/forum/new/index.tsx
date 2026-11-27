import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow } from '@tarojs/taro';
import { ScrollView, View, Text, Textarea } from '@tarojs/components';
import { BreadcrumbsMini, Field, Link, PrimaryButton } from '@repo/ui-mini';
import { APP_ERROR_CODES, fieldErrorMessage, t, topicCreateInput } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { mutationErrorMessage } from '../../../lib/load-error';
import { goLoginIfUnauthorized, LOGIN_PAGE, redirectToLogin } from '../../../lib/auth-redirect';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { usePendingSubmit } from '../../../lib/use-pending-submit';
import { leaveToTabPage, markListNeedsRefresh } from '../../../lib/list-refresh';
import { isPublicSafetyStatus, SUBMITTED_FOR_REVIEW_KEY } from '../../../lib/post-safety';
import { useStatusToast } from '../../../lib/status-toast';
import { StatusToast } from '../../../components/status-toast';
import './index.scss';

export default observer(function ForumNewPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<Notice<{ text: string }> | null>(null);
  const submit = usePendingSubmit();
  const loginRedirected = useRef(false);
  const toast = useStatusToast();

  useDidShow(() => {
    void Taro.setNavigationBarTitle({ title: tt('forum.new.title') });
    if (!session.isAuthenticated && !loginRedirected.current) {
      loginRedirected.current = true;
      redirectToLogin();
    }
  });

  const showError = (text: string) => setFormError({ id: nextNoticeId(), text });

  const publish = async () => {
    if (submit.pending) return;
    setFormError(null);
    const parsed = topicCreateInput.safeParse({ title, body });
    if (!parsed.success) {
      showError(fieldErrorMessage(locale.locale, parsed.error.issues[0]?.message));
      return;
    }
    if (!session.isAuthenticated) {
      redirectToLogin();
      return;
    }
    if (!submit.begin()) return;
    let leaveLocked = false;
    try {
      const created = await trpc.forum.topics.create.mutate(parsed.data);
      markListNeedsRefresh('forum');
      leaveLocked = true;
      if (!isPublicSafetyStatus(created.safetyStatus)) {
        toast.show(tt(SUBMITTED_FOR_REVIEW_KEY), { persistAcrossPages: true });
        leaveToTabPage('/pages/forum/list/index');
        return;
      }
      const url = `/pages/forum/detail/index?slug=${encodeURIComponent(created.slug)}`;
      // pass: go to the new topic. redirectTo so Back returns to the list
      // (tab), not the compose form, and keeps the 10-page stack smaller.
      void Taro.redirectTo({ url });
    } catch (error) {
      if (goLoginIfUnauthorized(error)) return;
      showError(
        mutationErrorMessage({
          locale: locale.locale,
          error,
          copy: { [APP_ERROR_CODES.CONTENT_BLOCKED]: tt('content.blocked') },
        }),
      );
    } finally {
      if (!leaveLocked) submit.end();
    }
  };

  return (
    <ScrollView scrollY className="forum-page">
      <View className="forum-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('forum.list.title'), to: '/pages/forum/list/index', mode: 'switchTab' },
            { label: tt('forum.new.title') },
          ]}
        />

        {session.isAuthenticated ? (
          <View>
            <Text className="forum-page__title">{tt('forum.new.title')}</Text>
            <Field
              label={tt('forum.new.titleLabel')}
              value={title}
              onInput={setTitle}
              placeholder={tt('forum.new.titlePlaceholder')}
              maxlength={120}
              disabled={submit.pending}
            />
            <Text className="forum-form__count">{title.length} / 120</Text>

            <Text id="forum-new-body-label" className="forum-field-label">
              {tt('forum.new.bodyLabel')}
            </Text>
            <Textarea
              className="forum-form__input"
              value={body}
              maxlength={10000}
              disabled={submit.pending ? true : undefined}
              ariaLabel={tt('forum.new.bodyLabel')}
              nativeProps={{ 'aria-labelledby': 'forum-new-body-label' }}
              onInput={(event) => setBody(event.detail.value)}
            />

            {formError ? (
              <View key={formError.id} className="forum-form__error" ariaRole="alert">
                <Text className="forum-form__error-text">{formError.text}</Text>
              </View>
            ) : null}

            <View className="forum-form__footer" data-toast-avoid>
              <Text className="forum-form__count">{body.length} / 10000</Text>
              <PrimaryButton
                label={submit.pending ? tt('forum.new.publishing') : tt('forum.new.publish')}
                disabled={submit.pending}
                onClick={() => void publish()}
              />
            </View>

            <Link to="/pages/forum/list/index" mode="back" className="forum-form__cancel">
              <Text>{tt('forum.new.cancel')}</Text>
            </Link>
          </View>
        ) : (
          <Link to={LOGIN_PAGE} mode="redirect" className="forum-login">
            <Text className="forum-login__text">{tt('forum.list.loginToPost')}</Text>
          </Link>
        )}
        <StatusToast notice={toast.notice} />
      </View>
    </ScrollView>
  );
});
