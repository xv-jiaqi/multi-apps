import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { t, topicUpdateInput } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { TopicForm } from '../components/topic-form';
import { useStores } from '../stores/root-store';
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

  const topicQuery = trpc.forum.topics.bySlug.useQuery({ slug }, { enabled: !!slug });
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [expiredByServer, setExpiredByServer] = useState(false);
  const [enteredAllowed, setEnteredAllowed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!session.isAuthenticated) {
      navigate('/login', { state: { from: `/forum/${slug}/edit` }, replace: true });
    }
  }, [navigate, session.isAuthenticated, slug]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const updateTopic = trpc.forum.topics.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.forum.topics.bySlug.invalidate({ slug }),
        utils.forum.topics.list.invalidate(),
      ]);
      navigate(`/forum/${slug}`, { replace: true, state: { notice: 'topicEdited' } });
    },
    onError(err) {
      if (err.data?.code === 'FORBIDDEN') {
        setExpiredByServer(true);
        setError(null);
        return;
      }
      setError(tt('forum.edit.saveFailed'));
    },
  });

  const topic = topicQuery.data;
  const serverOffsetMs = useMemo(() => {
    if (!topic?.serverNow) return 0;
    return Date.parse(topic.serverNow) - Date.now();
  }, [topic?.serverNow]);

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

  if (!session.isAuthenticated) return null;

  if (topicQuery.isLoading) {
    return (
      <PageShell>
        <PageMeta title={tt('forum.edit.title')} />
        <div className="space-y-4">
          <div className="h-10 w-1/3 animate-pulse rounded-md bg-neutral-200" />
          <div className="h-64 animate-pulse rounded-md bg-neutral-200" />
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
                ? 'rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500'
                : 'rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700'
            }
          >
            <p>{isNotFound ? tt('state.notFound') : tt('state.error')}</p>
            {!isNotFound ? (
              <button
                type="button"
                onClick={() => topicQuery.refetch()}
                className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
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
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-8 text-center text-neutral-600">
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
      setError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
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

        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">{tt('forum.edit.title')}</CardTitle>
            <p className="text-sm text-neutral-600" aria-live="off">
              {expired ? tt('forum.edit.expired') : formatRemaining(remainingMs, tt)}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {expired ? (
              <p
                role="alert"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
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
              onCancel={() => navigate(`/forum/${topic.slug}`)}
              onSubmit={onSubmit}
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
