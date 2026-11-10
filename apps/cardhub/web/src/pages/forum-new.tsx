import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Card, CardContent, CardHeader } from '@repo/ui-web';
import { fieldErrorMessage, t, topicCreateInput } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { TopicForm, type RestoredTopicDraft, type TopicFormValues } from '../components/topic-form';
import { BannedNotice } from '../components/banned-notice';
import { useStores } from '../stores/root-store';
import { useAppMutationError } from '../lib/app-mutation-error';
import {
  discardForumDraft,
  saveTopicDraft,
  takeTopicDraft,
  type TopicDraftTarget,
} from '../lib/forum-draft';
import { isSessionInvalidError, subscribeSessionExpired } from '../lib/session-expiry';
import { isSessionExpiryNavigationPending } from '../lib/session-expiry-redirect';
import { trpc } from '../lib/trpc';

const NEW_TOPIC_DRAFT: TopicDraftTarget = { kind: 'new' };

export const ForumNewPage = observer(function ForumNewPage() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const presentError = useAppMutationError();
  const tt = (key: string) => t(locale.locale, key);

  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // CH-226 §7: the draft under cardhub:draft:forum:new.
  const [restoredDraft, setRestoredDraft] = useState<RestoredTopicDraft | null>(null);
  const valuesRef = useRef<TopicFormValues>({ title: '', body: '' });
  const onValuesChange = useCallback((values: TopicFormValues) => {
    valuesRef.current = values;
  }, []);
  // Kept from render so a listener that runs after signOut() still has it.
  const draftUserIdRef = useRef<string | null>(null);
  if (session.user) draftUserIdRef.current = session.user.id;

  const create = trpc.forum.topics.create.useMutation({
    onSuccess(topic) {
      discardForumDraft(NEW_TOPIC_DRAFT);
      void utils.forum.topics.list.invalidate();
      navigate(`/forum/${topic.slug}`);
    },
    onError(err) {
      // §7-7: not an expired session, so the text is still in the form.
      if (!isSessionInvalidError(err)) discardForumDraft(NEW_TOPIC_DRAFT);
      const message = presentError(err);
      if (message) setError(message);
    },
  });

  // §7-4b: the session ended while typing (this page then goes to login).
  useEffect(
    () =>
      subscribeSessionExpired(() => {
        const userId = draftUserIdRef.current;
        if (userId) saveTopicDraft({ target: NEW_TOPIC_DRAFT, userId, draft: valuesRef.current });
      }),
    [],
  );

  // §7-5: restore once the form is on screen; a banned user gets no form.
  const userId = session.user?.id;
  const formShown = session.isAuthenticated && !session.isBanned;
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || restoredForRef.current === userId) return;
    restoredForRef.current = userId;
    if (!formShown) {
      discardForumDraft(NEW_TOPIC_DRAFT);
      return;
    }
    const restore = takeTopicDraft({ target: NEW_TOPIC_DRAFT, userId });
    if (restore.kind === 'restored') setRestoredDraft({ id: Date.now(), ...restore.draft });
  }, [formShown, userId]);

  // Bounce anonymous users back to login. The state.from contract makes the
  // existing redirect-after-login flow (M2) bring them straight here.
  // An expired session is already on its way to /login with sessionExpired.
  useEffect(() => {
    if (!session.isAuthenticated && !isSessionExpiryNavigationPending()) {
      navigate('/login', { state: { from: '/forum/new' }, replace: true });
    }
  }, [session.isAuthenticated, navigate]);

  if (!session.isAuthenticated) {
    return null;
  }

  const onSubmit = (values: { title: string; body: string }) => {
    setError(null);
    const parsed = topicCreateInput.safeParse(values);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]
          ? fieldErrorMessage(locale.locale, parsed.error.issues[0].message)
          : tt('state.error'),
      );
      return;
    }
    if (userId) saveTopicDraft({ target: NEW_TOPIC_DRAFT, userId, draft: values });
    create.mutate(parsed.data);
  };

  return (
    <PageShell>
      <PageMeta title={tt('forum.new.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('forum.list.title'), to: '/forum' },
            { label: tt('forum.new.title') },
          ]}
        />

        <Card className="border-card/60 bg-card/80 backdrop-blur">
          <CardHeader>
            <h1 className="font-semibold tracking-tight text-2xl">{tt('forum.new.title')}</h1>
            <p className="text-sm text-neutral-600">{tt('forum.new.subtitle')}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {session.isBanned ? (
              <>
                <BannedNotice>{tt('ban.cannotPost')}</BannedNotice>
                <Link
                  to="/forum"
                  className="inline-flex min-h-6 items-center text-sm text-link hover:underline"
                >
                  {tt('ban.backToForum')}
                </Link>
              </>
            ) : (
              <TopicForm
                titleLabel={tt('forum.new.titleLabel')}
                titlePlaceholder={tt('forum.new.titlePlaceholder')}
                bodyLabel={tt('forum.new.bodyLabel')}
                bodyPlaceholder={tt('forum.new.bodyPlaceholder')}
                markdownHint={tt('forum.new.markdownHint')}
                mentionHint={tt('comments.mentionHint')}
                showPreviewLabel={tt('forum.new.showPreview')}
                hidePreviewLabel={tt('forum.new.hidePreview')}
                previewEmptyLabel={tt('forum.new.previewEmpty')}
                cancelLabel={tt('forum.new.cancel')}
                submitLabel={tt('forum.new.publish')}
                submittingLabel={tt('forum.new.publishing')}
                error={error}
                isSubmitting={create.isPending}
                restoredDraft={restoredDraft}
                restoredLabel={tt('forum.draft.restored')}
                onValuesChange={onValuesChange}
                onCancel={() => {
                  discardForumDraft(NEW_TOPIC_DRAFT);
                  navigate('/forum');
                }}
                onSubmit={onSubmit}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
