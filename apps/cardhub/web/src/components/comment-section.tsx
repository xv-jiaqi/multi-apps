import { observer } from 'mobx-react-lite';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@repo/ui-web';
import { commentInput, t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

interface CommentSectionProps {
  cardSlug: string;
}

export const CommentSection = observer(function CommentSection({ cardSlug }: CommentSectionProps) {
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  const list = trpc.comments.listForCard.useQuery({ cardSlug });
  const utils = trpc.useUtils();
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.comments.create.useMutation({
    onSuccess() {
      setContent('');
      void utils.comments.listForCard.invalidate({ cardSlug });
    },
    onError(err) {
      setError(err.message);
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = commentInput.safeParse({ cardSlug, content });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '');
      return;
    }
    create.mutate(parsed.data);
  };

  return (
    <div className="space-y-4">
      {session.isAuthenticated ? (
        <form
          onSubmit={onSubmit}
          className="space-y-2 rounded-2xl border border-white/60 bg-white/80 p-4 backdrop-blur"
        >
          <label htmlFor="comment-content" className="sr-only">
            {tt('a11y.commentArea')}
          </label>
          <textarea
            id="comment-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={tt('card.detail.commentPlaceholder')}
            rows={3}
            maxLength={500}
            aria-label={tt('a11y.commentArea')}
            className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-500">{content.length} / 500</span>
            <Button type="submit" disabled={create.isPending || !content.trim()}>
              {create.isPending
                ? tt('card.detail.commentSubmitting')
                : tt('card.detail.commentSubmit')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-4 text-center text-sm text-neutral-600 backdrop-blur">
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            {tt('card.detail.loginToComment')}
          </Link>
        </p>
      )}

      {list.isLoading ? (
        <p className="text-sm text-neutral-500">{tt('state.loading')}</p>
      ) : list.isError ? (
        <p className="text-sm text-red-600">{list.error.message}</p>
      ) : !list.data || list.data.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 bg-white/60 p-4 text-center text-sm text-neutral-500">
          {tt('card.detail.commentEmpty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.data.map((comment) => (
            <li
              key={comment.id}
              className="rounded-xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur"
            >
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span className="font-semibold text-neutral-900">@{comment.user.username}</span>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString(locale.locale)}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{comment.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
