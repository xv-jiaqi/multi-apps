import { observer } from 'mobx-react-lite';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { t, topicCreateInput } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { MarkdownView } from '../components/markdown-view';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const ForumNewPage = observer(function ForumNewPage() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const tt = (key: string) => t(locale.locale, key);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const utils = trpc.useUtils();

  const create = trpc.forum.topics.create.useMutation({
    onSuccess(topic) {
      void utils.forum.topics.list.invalidate();
      navigate(`/forum/${topic.slug}`);
    },
    onError(err) {
      setError(err.message);
    },
  });

  // Bounce anonymous users back to login. The state.from contract makes the
  // existing redirect-after-login flow (M2) bring them straight here.
  useEffect(() => {
    if (!session.isAuthenticated) {
      navigate('/login', { state: { from: '/forum/new' }, replace: true });
    }
  }, [session.isAuthenticated, navigate]);

  if (!session.isAuthenticated) {
    return null;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = topicCreateInput.safeParse({ title, body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
    create.mutate(parsed.data);
  };

  return (
    <PageShell>
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('forum.list.title'), to: '/forum' },
            { label: tt('forum.new.title') },
          ]}
        />

        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">{tt('forum.new.title')}</CardTitle>
            <p className="text-sm text-neutral-600">{tt('forum.new.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="topic-title" className="text-sm font-medium text-neutral-700">
                  {tt('forum.new.titleLabel')}
                </label>
                <input
                  id="topic-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder={tt('forum.new.titlePlaceholder')}
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="topic-body" className="text-sm font-medium text-neutral-700">
                    {tt('forum.new.bodyLabel')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    {showPreview ? tt('forum.new.hidePreview') : tt('forum.new.showPreview')}
                  </button>
                </div>
                {showPreview ? (
                  <div className="min-h-[16rem] rounded-md border border-neutral-200 bg-white px-3 py-2">
                    {body.trim() ? (
                      <MarkdownView body={body} />
                    ) : (
                      <p className="text-sm text-neutral-400">{tt('forum.new.previewEmpty')}</p>
                    )}
                  </div>
                ) : (
                  <textarea
                    id="topic-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={12}
                    maxLength={10_000}
                    className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
                    placeholder={tt('forum.new.bodyPlaceholder')}
                  />
                )}
                <p className="text-xs text-neutral-500">{tt('forum.new.markdownHint')}</p>
              </div>

              {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/forum')}
                  disabled={create.isPending}
                >
                  {tt('forum.new.cancel')}
                </Button>
                <Button type="submit" disabled={create.isPending || !title.trim() || !body.trim()}>
                  {create.isPending ? tt('forum.new.publishing') : tt('forum.new.publish')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
