import { observer } from 'mobx-react-lite';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { replyBodySchema, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { MarkdownView } from '../components/markdown-view';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const ForumDetailPage = observer(function ForumDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const topicQuery = trpc.forum.topics.bySlug.useQuery({ slug }, { enabled: !!slug });
  const utils = trpc.useUtils();

  const [replyBody, setReplyBody] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);

  const createReply = trpc.forum.replies.create.useMutation({
    onSuccess() {
      setReplyBody('');
      setReplyError(null);
      void utils.forum.topics.bySlug.invalidate({ slug });
    },
    onError(err) {
      setReplyError(err.message);
    },
  });

  const deleteTopic = trpc.forum.topics.delete.useMutation({
    onSuccess() {
      void utils.forum.topics.list.invalidate();
      navigate('/forum');
    },
  });

  const deleteReply = trpc.forum.replies.delete.useMutation({
    onSuccess() {
      void utils.forum.topics.bySlug.invalidate({ slug });
    },
  });

  if (topicQuery.isLoading) {
    return (
      <PageShell>
        <div className="space-y-4">
          <div className="h-6 w-1/3 animate-pulse rounded bg-neutral-200" />
          <div className="h-32 animate-pulse rounded-2xl bg-white/60" />
        </div>
      </PageShell>
    );
  }

  if (topicQuery.isError || !topicQuery.data) {
    const isNotFound = topicQuery.error?.data?.code === 'NOT_FOUND';
    return (
      <PageShell>
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('forum.list.title'), to: '/forum' },
              { label: slug },
            ]}
          />
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {isNotFound ? tt('state.notFound') : (topicQuery.error?.message ?? tt('state.error'))}
          </p>
        </div>
      </PageShell>
    );
  }

  const topic = topicQuery.data;
  const isOwner = session.user?.id === topic.author.id;

  const onSubmitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReplyError(null);
    const parsed = replyBodySchema.safeParse(replyBody);
    if (!parsed.success) {
      setReplyError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
    createReply.mutate({ topicId: topic.id, body: parsed.data });
  };

  return (
    <PageShell>
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('forum.list.title'), to: '/forum' },
            { label: topic.title },
          ]}
        />

        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-2xl">{topic.title}</CardTitle>
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(tt('forum.detail.confirmDelete'))) {
                      deleteTopic.mutate({ id: topic.id });
                    }
                  }}
                  disabled={deleteTopic.isPending}
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {tt('forum.detail.delete')}
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">@{topic.author.username}</span>
              <time dateTime={topic.createdAt}>
                {new Date(topic.createdAt).toLocaleString(locale.locale)}
              </time>
            </div>
          </CardHeader>
          <CardContent>
            <MarkdownView body={topic.body} />
          </CardContent>
        </Card>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">
            {tt('forum.detail.repliesTitle', { count: topic.replyCount })}
          </h2>

          {topic.replies.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-200 bg-white/60 p-4 text-center text-sm text-neutral-500">
              {tt('forum.detail.noReplies')}
            </p>
          ) : (
            <ul className="space-y-3">
              {topic.replies.map((reply) => {
                const canDelete = session.user?.id === reply.author.id;
                return (
                  <li
                    key={reply.id}
                    className="rounded-2xl border border-white/60 bg-white/80 p-4 backdrop-blur"
                  >
                    <div className="flex items-center justify-between text-xs text-neutral-500">
                      <span className="font-medium text-neutral-700">@{reply.author.username}</span>
                      <div className="flex items-center gap-3">
                        <time dateTime={reply.createdAt}>
                          {new Date(reply.createdAt).toLocaleString(locale.locale)}
                        </time>
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(tt('forum.detail.confirmDeleteReply'))) {
                                deleteReply.mutate({ id: reply.id });
                              }
                            }}
                            className="text-red-600 hover:underline"
                          >
                            {tt('forum.detail.delete')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2">
                      <MarkdownView body={reply.body} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {session.isAuthenticated ? (
            <form
              onSubmit={onSubmitReply}
              className="space-y-2 rounded-2xl border border-white/60 bg-white/80 p-4 backdrop-blur"
            >
              <label htmlFor="reply-body" className="block text-sm font-medium text-neutral-700">
                {tt('forum.detail.replyLabel')}
              </label>
              <textarea
                id="reply-body"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={tt('forum.detail.replyPlaceholder')}
                rows={4}
                maxLength={5000}
                className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              {replyError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {replyError}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-neutral-500">{tt('forum.detail.markdownNote')}</span>
                <Button type="submit" disabled={createReply.isPending || !replyBody.trim()}>
                  {createReply.isPending
                    ? tt('forum.detail.replySubmitting')
                    : tt('forum.detail.replySubmit')}
                </Button>
              </div>
            </form>
          ) : (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-4 text-center text-sm text-neutral-600 backdrop-blur">
              <Link
                to="/login"
                state={{ from: `/forum/${slug}` }}
                className="font-medium text-brand-600 hover:underline"
              >
                {tt('forum.detail.loginToReply')}
              </Link>
            </p>
          )}
        </section>
      </div>
    </PageShell>
  );
});
