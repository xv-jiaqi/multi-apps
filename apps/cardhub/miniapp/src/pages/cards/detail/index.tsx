import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useRouter } from '@tarojs/taro';
import { ScrollView, View, Text, Textarea } from '@tarojs/components';
import {
  BreadcrumbsMini,
  Empty,
  Link,
  PrimaryButton,
  RarityBadge,
  SectionCard,
  Skeleton,
  type Rarity,
} from '@repo/ui-mini';
import { APP_ERROR_CODES, commentInput, fieldErrorMessage, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { LocalNotFoundError, mutationErrorMessage } from '../../../lib/load-error';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { useBlock } from '../../../lib/use-block';
import { ArtworkMini } from '../../../components/artwork-mini';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import { StatusToast } from '../../../components/status-toast';
import { isPublicSafetyStatus, SUBMITTED_FOR_REVIEW_KEY } from '../../../lib/post-safety';
import { useStatusToast } from '../../../lib/status-toast';
import './index.scss';

type CardBySlugResult = Awaited<ReturnType<typeof trpc.cards.bySlug.query>>;
type CommentsResult = Awaited<ReturnType<typeof trpc.comments.listForCard.query>>;

const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

function isRarity(value: string): value is Rarity {
  return (RARITY_ORDER as readonly string[]).includes(value);
}

function normalizeRarity(rarity: string | null): Rarity {
  return rarity && isRarity(rarity) ? rarity : 'common';
}

export default observer(function CardDetailPage() {
  const router = useRouter();
  const slug = (router.params.slug ?? '').toString();
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const cardBlock = useBlock<CardBySlugResult>(async () => {
    if (!slug) throw new LocalNotFoundError('missing slug');
    const result = await trpc.cards.bySlug.query({ slug });
    void Taro.setNavigationBarTitle({ title: result.name });
    return result;
  });
  // CH-301 §4: the miniapp surface only lists checked comments (plus the
  // viewer's own ones under review).
  const commentsBlock = useBlock<CommentsResult>(async () => {
    if (!slug) throw new LocalNotFoundError('missing slug');
    return trpc.comments.listForCard.query({ cardSlug: slug, limit: 50, surface: 'miniapp' });
  });
  const loadCard = cardBlock.load;
  const loadComments = commentsBlock.load;

  const [commentContent, setCommentContent] = useState('');
  const [commentError, setCommentError] = useState<Notice<{ text: string }> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const toast = useStatusToast();

  useEffect(() => {
    void loadCard();
    void loadComments();
  }, [slug, loadCard, loadComments]);

  const showCommentError = (text: string) => setCommentError({ id: nextNoticeId(), text });

  const submitComment = async () => {
    if (submitting || submittingRef.current) return;
    setCommentError(null);
    const parsed = commentInput.safeParse({ cardSlug: slug, content: commentContent });
    if (!parsed.success) {
      showCommentError(fieldErrorMessage(locale.locale, parsed.error.issues[0]?.message));
      return;
    }
    if (!session.token) {
      showCommentError(tt('card.detail.loginToComment'));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const created = await trpc.comments.create.mutate(parsed.data);
      setCommentContent('');
      if (!isPublicSafetyStatus(created.safetyStatus)) {
        toast.show(tt(SUBMITTED_FOR_REVIEW_KEY));
        return;
      }
      void Taro.showToast({ title: tt('miniapp.toast.commentOk'), icon: 'success' });
      await loadComments({ fresh: true, keepDataOnError: true });
    } catch (error) {
      showCommentError(
        mutationErrorMessage({
          locale: locale.locale,
          error,
          copy: {
            [APP_ERROR_CODES.CONTENT_BLOCKED]: tt('content.blocked'),
            [APP_ERROR_CODES.TOO_MANY_REQUESTS]: tt('card.detail.commentRateLimited'),
          },
        }),
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const cardView = resolveBlockView({ state: cardBlock.state, isEmpty: () => false });
  const commentsView = resolveBlockView({
    state: commentsBlock.state,
    isEmpty: (items) => items.length === 0,
  });
  const card = cardView.kind === 'success' ? cardView.data : null;

  return (
    <ScrollView scrollY className="card-detail-page">
      <View className="card-detail-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('breadcrumb.series'), to: '/pages/series/list/index' },
            ...(card
              ? [
                  {
                    label: card.seriesTitle,
                    to: `/pages/series/detail/index?slug=${card.seriesSlug}`,
                  },
                ]
              : []),
            { label: card?.name ?? slug },
          ]}
        />

        {cardView.kind === 'failed' ? (
          <ErrorBoxMini
            key={cardView.noticeId}
            title={tt('card.detail.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={cardView.retrying}
            onRetry={() => void loadCard()}
          />
        ) : cardView.kind === 'notFound' ? (
          <Empty title={tt('state.notFound')} />
        ) : cardView.kind !== 'success' ? (
          <View>
            <Skeleton height="640rpx" />
            <Skeleton height="220rpx" />
          </View>
        ) : (
          <View>
            <View className="card-hero">
              <ArtworkMini
                src={cardView.data.imageUrl}
                slug={cardView.data.slug}
                ratio="card"
                mode="aspectFit"
                label={cardView.data.name}
              />
            </View>

            <View className="card-detail-page__heading">
              <Text className="card-detail-page__name">{cardView.data.name}</Text>
              <RarityBadge rarity={normalizeRarity(cardView.data.rarity)} locale={locale.locale} />
            </View>
            {cardView.data.description ? (
              <Text className="card-detail-page__description">{cardView.data.description}</Text>
            ) : null}
            <View className="card-detail-page__series">
              <Text className="card-detail-page__meta">{tt('card.detail.series')} · </Text>
              <Link to={`/pages/series/detail/index?slug=${cardView.data.seriesSlug}`}>
                <Text className="card-detail-page__link">{cardView.data.seriesTitle}</Text>
              </Link>
            </View>

            <View className="card-detail-page__gap" />

            <SectionCard title={tt('card.detail.attributes')}>
              {Object.keys(cardView.data.attributes ?? {}).length === 0 ? (
                <Text className="card-detail-page__meta">—</Text>
              ) : (
                <View className="card-attributes">
                  {Object.entries(cardView.data.attributes ?? {}).map(([key, value]) => (
                    <View key={key} className="card-attributes__item">
                      <Text className="card-attributes__key">{key}</Text>
                      <Text className="card-attributes__value">{String(value)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </SectionCard>

            <View className="card-detail-page__gap" />

            <SectionCard title={tt('card.detail.commentsTitle')}>
              {session.isAuthenticated ? (
                <View className="comment-form">
                  <Textarea
                    className="comment-form__input"
                    value={commentContent}
                    placeholder={tt('card.detail.commentPlaceholder')}
                    maxlength={500}
                    onInput={(e) => setCommentContent(e.detail.value)}
                  />
                  {commentError ? (
                    <View key={commentError.id} className="comment-form__error" ariaRole="alert">
                      <Text className="comment-form__error-text">{commentError.text}</Text>
                    </View>
                  ) : null}
                  <View className="comment-form__footer">
                    <Text className="card-detail-page__meta comment-form__count">
                      {commentContent.length} / 500
                    </Text>
                    <PrimaryButton
                      label={
                        submitting
                          ? tt('card.detail.commentSubmitting')
                          : tt('card.detail.commentSubmit')
                      }
                      disabled={submitting || !commentContent.trim()}
                      onClick={submitComment}
                    />
                  </View>
                </View>
              ) : (
                <Link to="/pages/auth/login/index" className="comment-login">
                  <Text className="comment-login__text">{tt('card.detail.loginToComment')}</Text>
                </Link>
              )}

              {commentsView.kind === 'failed' ? (
                <ErrorBoxMini
                  key={commentsView.noticeId}
                  title={tt('card.detail.commentsLoadFailed')}
                  retryLabel={tt('state.retry')}
                  retryingLabel={tt('state.retrying')}
                  retrying={commentsView.retrying}
                  onRetry={() => void loadComments()}
                />
              ) : commentsView.kind === 'loading' ? (
                <View>
                  <Skeleton height="120rpx" />
                  <Skeleton height="120rpx" />
                </View>
              ) : commentsView.kind === 'empty' || commentsView.kind === 'notFound' ? (
                <Empty title={tt('card.detail.commentEmpty')} />
              ) : (
                <View>
                  {commentsView.data.map((comment) => (
                    <View key={comment.id} className="comment-item">
                      <View className="comment-item__meta">
                        <Text className="comment-item__author">@{comment.user.username}</Text>
                        <Text className="card-detail-page__meta">
                          {new Date(comment.createdAt).toLocaleString(locale.locale)}
                        </Text>
                      </View>
                      <Text className="comment-item__content">{comment.content}</Text>
                    </View>
                  ))}
                </View>
              )}
            </SectionCard>
          </View>
        )}
        <StatusToast notice={toast.notice} />
      </View>
    </ScrollView>
  );
});
