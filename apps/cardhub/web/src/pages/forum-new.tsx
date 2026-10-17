import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { t, topicCreateInput } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { TopicForm } from '../components/topic-form';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const ForumNewPage = observer(function ForumNewPage() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const tt = (key: string) => t(locale.locale, key);

  const [error, setError] = useState<string | null>(null);
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

  const onSubmit = (values: { title: string; body: string }) => {
    setError(null);
    const parsed = topicCreateInput.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
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

        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">{tt('forum.new.title')}</CardTitle>
            <p className="text-sm text-neutral-600">{tt('forum.new.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <TopicForm
              titleLabel={tt('forum.new.titleLabel')}
              titlePlaceholder={tt('forum.new.titlePlaceholder')}
              bodyLabel={tt('forum.new.bodyLabel')}
              bodyPlaceholder={tt('forum.new.bodyPlaceholder')}
              markdownHint={tt('forum.new.markdownHint')}
              showPreviewLabel={tt('forum.new.showPreview')}
              hidePreviewLabel={tt('forum.new.hidePreview')}
              previewEmptyLabel={tt('forum.new.previewEmpty')}
              cancelLabel={tt('forum.new.cancel')}
              submitLabel={tt('forum.new.publish')}
              submittingLabel={tt('forum.new.publishing')}
              error={error}
              isSubmitting={create.isPending}
              onCancel={() => navigate('/forum')}
              onSubmit={onSubmit}
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
