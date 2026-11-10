import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Card, CardContent, CardHeader } from '@repo/ui-web';
import { APP_ERROR_CODES, fieldErrorMessage, t, topicUpdateInput } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { TopicForm, type RestoredTopicDraft, type TopicFormValues } from '../components/topic-form';
import { BannedNotice } from '../components/banned-notice';
import { useStores } from '../stores/root-store';
import { useAppMutationError } from '../lib/app-mutation-error';
import { discardForumDraft, peekTopicDraft, saveTopicDraft } from '../lib/forum-draft';
import { isSessionInvalidError, subscribeSessionExpired } from '../lib/session-expiry';
import { isSessionExpiryNavigationPending } from '../lib/session-expiry-redirect';
import { trpc } from '../lib/trpc';

function formatRemaining(ms: number, tt: (key: string, vars?: Record<string, number>) => string) {
  if (ms < 60_000) return tt('forum.edit.remainingUnderMinute');
  return tt('forum.edit.remaining', { minutes: Math.ceil(ms / 60_000) });
}

export const ForumEditPage = observer(function ForumEditPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const presentError = useAppMutationError();
  const topicQuery = trpc.forum.topics.bySlug.useQuery({ slug }, { enabled: !!slug });
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [expiredByServer, setExpiredByServer] = useState(false);
  const [enteredAllowed, setEnteredAllowed] = useState(false);
  const [tick, setTick] = useState(0);

  // CH-226 §7: the draft under cardhub:draft:forum:edit:<topic.id>.
  const valuesRef = useRef<TopicFormValues | null>(null);
  const onValuesChange = useCallback((values: TopicFormValues) => {
    valuesRef.current = values;
  }, []);
  // Kept from render so a listener that runs after signOut() still has it.
  const draftUserIdRef = useRef<string | null>(null);
  if (session.user) draftUserIdRef.current = session.user.id;
  const draftTopicIdRef = useRef<string | null>(null);
  draftTopicIdRef.current = topicQuery.data?.id ?? null;
  const discardEditDraft = () => {
    const topicId = draftTopicIdRef.current;
    if (topicId) discardForumDraft({ kind: 'edit', topicId });
  };

  // An expired session is already on its way to /login with sessionExpired.
  useEffect(() => {
    if (!session.isAuthenticated && !isSessionExpiryNavigationPending()) {
      navigate('/login', { state: { from: `/forum/${slug}/edit` }, replace: true });
    }
  }, [navigate, session.isAuthenticated, slug]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const updateTopic = trpc.forum.topics.update.useMutation({
    async onSuccess() {
      discardEditDraft();
      await Promise.all([
        utils.forum.topics.bySlug.invalidate({ slug }),
        utils.forum.topics.list.invalidate(),
      ]);
      navigate(`/forum/${slug}`, { replace: true, state: { notice: 'topicEdited' } });
    },
    onError(err) {
      // §7-7: not an expired session, so the text is still in the form.
      if (!isSessionInvalidError(err)) discardEditDraft();
      if (err.data?.appCode === APP_ERROR_CODES.USER_BANNED) {
        const message = presentError(err);
        if (message) setError(message);
        return;
      }
      if (err.data?.code === 'FORBIDDEN') {
        setExpiredByServer(true);
        setError(null);
        return;
      }
      setError(tt('forum.edit.saveFailed'));
    },
  });

  const topic = topicQuery.data;
  // §7-10 (a): skew between the server clock and ours at the moment the data
  // was fetched. Date.now() at mount would count a cached topic's age as skew.
  const { dataUpdatedAt } = topicQuery;
  const serverOffsetMs = useMemo(() => {
    if (!topic?.serverNow || !dataUpdatedAt) return 0;
    return Date.parse(topic.serverNow) - dataUpdatedAt;
  }, [dataUpdatedAt, topic?.serverNow]);

  useEffect(() => {
    if (!topic?.editableUntil) return;
    const deadline = Date.parse(topic.editableUntil) - serverOffsetMs;
    const delay = deadline - Date.now();
    if (delay <= 0) return;
    const id = window.setTimeout(() => setTick((value) => value + 1), delay);
    return () => window.clearTimeout(id);
  }, [serverOffsetMs, topic?.editableUntil]);

  const remainingMs = useMemo(() => {
    if (!topic?.editableUntil) return 0;
    return Date.parse(topic.editableUntil) - (Date.now() + serverOffsetMs);
    // `tick` intentionally recomputes Date.now every 30 seconds.
  }, [serverOffsetMs, tick, topic?.editableUntil]);
  const isOwner = session.user?.id === topic?.author.id;
  const isWithinWindow = remainingMs > 0 && !expiredByServer;

  useEffect(() => {
    if (isOwner && isWithinWindow) setEnteredAllowed(true);
  }, [isOwner, isWithinWindow]);

  // §7-4b: the session ended mid-edit (this page then goes to login). Only
  // once the form has reported its fields, so nothing is saved before it shows.
  useEffect(
    () =>
      subscribeSessionExpired(() => {
        const userId = draftUserIdRef.current;
        const topicId = draftTopicIdRef.current;
        const values = valuesRef.current;
        if (userId && topicId && values) {
          saveTopicDraft({ target: { kind: 'edit', topicId }, userId, draft: values });
        }
      }),
    [],
  );

  // §7-5 / §7-10 (b): decided during render, once per topic and user, so the
  // first frame already knows whether there is a draft to bring back. Read
  // only here; the key is removed in the effect below. Banned users and
  // non-authors get no form, so their draft is dropped. §7-6 v1.2: an author
  // with a valid draft is treated as having entered while editable.
  const canHaveForm = !session.isBanned && topic !== undefined && isOwner;
  const restoreTopicId = topic?.id;
  const restoreUserId = session.user?.id;
  const [restore, setRestore] = useState<{
    topicId: string;
    userId: string;
    draft: RestoredTopicDraft | null;
  } | null>(null);
  if (
    restoreTopicId &&
    restoreUserId &&
    (restore?.topicId !== restoreTopicId || restore.userId !== restoreUserId)
  ) {
    const peeked = canHaveForm
      ? peekTopicDraft({ target: { kind: 'edit', topicId: restoreTopicId }, userId: restoreUserId })
      : null;
    const draft = peeked?.kind === 'restored' ? { id: Date.now(), ...peeked.draft } : null;
    setRestore({ topicId: restoreTopicId, userId: restoreUserId, draft });
    if (draft) setEnteredAllowed(true);
  }
  const restoredDraft = restore?.draft ?? null;
  // Keyed on the decision, not the live session: when the session ends the
  // user goes to null and the draft saved for §7-4 must survive that render.
  const decidedTopicId = restore?.topicId;
  const decidedUserId = restore?.userId;
  useEffect(() => {
    if (decidedTopicId) discardForumDraft({ kind: 'edit', topicId: decidedTopicId });
  }, [decidedTopicId, decidedUserId]);

  if (!session.isAuthenticated) return null;

  if (session.isBanned) {
    return (
      <PageShell>
        <PageMeta title={tt('forum.edit.title')} />
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('forum.list.title'), to: '/forum' },
              { label: slug, to: `/forum/${slug}` },
              { label: tt('forum.detail.edit') },
            ]}
          />
          <BannedNotice>{tt('ban.cannotEdit')}</BannedNotice>
        </div>
      </PageShell>
    );
  }

  if (topicQuery.isLoading) {
    return (
      <PageShell>
        <PageMeta title={tt('forum.edit.title')} />
        <div className="space-y-4">
          <div className="h-10 w-1/3 animate-pulse motion-reduce:animate-none rounded-md bg-neutral-200" />
          <div className="h-64 animate-pulse motion-reduce:animate-none rounded-md bg-neutral-200" />
        </div>
      </PageShell>
    );
  }

  if (topicQuery.isError || !topic) {
    const isNotFound = topicQuery.error?.data?.code === 'NOT_FOUND';
    return (
      <PageShell>
        <PageMeta title={tt('forum.edit.title')} />
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('forum.list.title'), to: '/forum' },
              { label: slug },
              { label: tt('forum.detail.edit') },
            ]}
          />
          <div
            className={
              isNotFound
                ? 'rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600'
                : 'rounded-lg border border-danger-border bg-danger-soft p-6 text-sm text-danger'
            }
          >
            <p>{isNotFound ? tt('state.notFound') : tt('state.error')}</p>
            {!isNotFound ? (
              <button
                type="button"
                onClick={() => topicQuery.refetch()}
                className="mt-3 rounded-md border border-danger-border-strong bg-card px-3 py-1 text-xs font-medium text-danger hover:bg-danger-soft-strong"
              >
                {tt('state.retry')}
              </button>
            ) : null}
          </div>
        </div>
      </PageShell>
    );
  }

  if (!isOwner || (!enteredAllowed && !isWithinWindow)) {
    return (
      <PageShell>
        <PageMeta title={tt('forum.edit.title')} />
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('forum.list.title'), to: '/forum' },
              { label: topic.title, to: `/forum/${topic.slug}` },
              { label: tt('forum.detail.edit') },
            ]}
          />
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-card/70 p-8 text-center text-neutral-600">
            <p>{tt('forum.edit.notAllowed')}</p>
            <Link
              to={`/forum/${topic.slug}`}
              className="mt-3 inline-flex rounded-md border border-neutral-200 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              {tt('forum.edit.backToTopic')}
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  const expired = !isWithinWindow;

  const onSubmit = (values: { title: string; body: string }) => {
    setError(null);
    const parsed = topicUpdateInput.safeParse({ id: topic.id, ...values });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]
          ? fieldErrorMessage(locale.locale, parsed.error.issues[0].message)
          : tt('state.error'),
      );
      return;
    }
    const userId = session.user?.id;
    if (userId)
      saveTopicDraft({ target: { kind: 'edit', topicId: topic.id }, userId, draft: values });
    updateTopic.mutate(parsed.data);
  };

  return (
    <PageShell>
      <PageMeta title={tt('forum.edit.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('forum.list.title'), to: '/forum' },
            { label: topic.title, to: `/forum/${topic.slug}` },
            { label: tt('forum.detail.edit') },
          ]}
        />

        <Card className="border-card/60 bg-card/80 backdrop-blur">
          <CardHeader>
            <h1 className="font-semibold tracking-tight text-2xl">{tt('forum.edit.title')}</h1>
            <p className="text-sm text-neutral-600" aria-live="off">
              {expired ? tt('forum.edit.expired') : formatRemaining(remainingMs, tt)}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {expired ? (
              <p
                role="alert"
                className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning"
              >
                {tt('forum.edit.expired')}
              </p>
            ) : null}
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
              cancelLabel={tt('forum.edit.cancel')}
              submitLabel={tt('forum.edit.save')}
              submittingLabel={tt('forum.edit.saving')}
              initialTitle={topic.title}
              initialBody={topic.body}
              error={error}
              isSubmitting={updateTopic.isPending}
              submitDisabled={expired}
              focusTitle
              restoredDraft={restoredDraft}
              restoredLabel={tt('forum.draft.restored')}
              onValuesChange={onValuesChange}
              onCancel={() => {
                discardForumDraft({ kind: 'edit', topicId: topic.id });
                navigate(`/forum/${topic.slug}`);
              }}
              onSubmit={onSubmit}
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
