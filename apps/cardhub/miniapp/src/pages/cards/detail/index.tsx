import { useEffect, useState } from 'react';
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
import { commentInput, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { gradientFor } from '../../../lib/gradients';

type CardBySlugResult = Awaited<ReturnType<typeof trpc.cards.bySlug.query>>;
type CommentsResult = Awaited<ReturnType<typeof trpc.comments.listForCard.query>>;

const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

function normalizeRarity(rarity: string | null): Rarity {
  if (rarity && (RARITY_ORDER as readonly string[]).includes(rarity)) {
    return rarity as Rarity;
  }
  return 'common';
}

export default observer(function CardDetailPage() {
  const router = useRouter();
  const slug = (router.params.slug ?? '').toString();
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [card, setCard] = useState<CardBySlugResult | null>(null);
  const [cardLoading, setCardLoading] = useState(true);
  const [cardError, setCardError] = useState<string | null>(null);

  const [comments, setComments] = useState<CommentsResult>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentContent, setCommentContent] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadCard = async () => {
    if (!slug) {
      setCardLoading(false);
      setCardError(tt('state.notFound'));
      return;
    }
    setCardLoading(true);
    setCardError(null);
    try {
      const result = await trpc.cards.bySlug.query({ slug });
      setCard(result);
      void Taro.setNavigationBarTitle({ title: result.name });
    } catch (e) {
      setCardError(e instanceof Error ? e.message : String(e));
    } finally {
      setCardLoading(false);
    }
  };

  const loadComments = async () => {
    if (!slug) {
      setCommentsLoading(false);
      return;
    }
    setCommentsLoading(true);
    try {
      const result = await trpc.comments.listForCard.query({ cardSlug: slug, limit: 50 });
      setComments(result);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    void loadCard();
    void loadComments();
  }, [slug]);

  const submitComment = async () => {
    setCommentError(null);
    const parsed = commentInput.safeParse({ cardSlug: slug, content: commentContent });
    if (!parsed.success) {
      setCommentError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
    if (!session.token) {
      setCommentError(tt('card.detail.loginToComment'));
      return;
    }
    setSubmitting(true);
    try {
      await trpc.comments.create.mutate(parsed.data);
      setCommentContent('');
      void Taro.showToast({ title: tt('miniapp.toast.commentOk'), icon: 'success' });
      await loadComments();
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const attributes = card?.attributes ?? {};

  return (
    <ScrollView scrollY style={{ height: '100vh' }}>
      <View style={{ padding: '32rpx' }}>
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index' },
            { label: tt('breadcrumb.series'), to: '/pages/series/list/index' },
            card
              ? {
                  label: card.seriesTitle,
                  to: `/pages/series/detail/index?slug=${card.seriesSlug}`,
                }
              : { label: tt('breadcrumb.series') },
            { label: card?.name ?? slug },
          ]}
        />

        {cardLoading ? (
          <View>
            <Skeleton height="440rpx" />
            <Skeleton height="220rpx" />
          </View>
        ) : cardError || !card ? (
          <View>
            <Empty title={cardError ?? tt('state.notFound')} />
            <View style={{ height: '16rpx' }} />
            <PrimaryButton label={tt('state.retry')} onClick={loadCard} />
          </View>
        ) : (
          <View>
            <View
              style={{
                height: '480rpx',
                borderRadius: '24rpx',
                background: gradientFor(card.slug),
                marginBottom: '24rpx',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <Text
                style={{
                  position: 'absolute',
                  bottom: '24rpx',
                  left: '32rpx',
                  fontSize: '80rpx',
                  fontWeight: 900,
                  color: 'rgba(255,255,255,0.7)',
                  letterSpacing: '8rpx',
                }}
              >
                {card.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>

            <View
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16rpx',
                flexWrap: 'wrap',
                marginBottom: '12rpx',
              }}
            >
              <Text style={{ fontSize: '40rpx', fontWeight: 700, color: '#171717' }}>
                {card.name}
              </Text>
              <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
            </View>
            <Text style={{ fontSize: '26rpx', color: '#525252' }}>{card.description}</Text>
            <View style={{ height: '8rpx' }} />
            <Text style={{ fontSize: '22rpx', color: '#737373' }}>
              {tt('card.detail.series')}
              {' · '}
              <Link to={`/pages/series/detail/index?slug=${card.seriesSlug}`}>
                <Text style={{ color: '#2563eb' }}>{card.seriesTitle}</Text>
              </Link>
            </Text>

            <View style={{ height: '24rpx' }} />

            <SectionCard title={tt('card.detail.attributes')}>
              {Object.keys(attributes).length === 0 ? (
                <Text style={{ fontSize: '24rpx', color: '#737373' }}>—</Text>
              ) : (
                <View
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: '16rpx',
                  }}
                >
                  {Object.entries(attributes).map(([key, value]) => (
                    <View key={key} style={{ minWidth: '180rpx', marginRight: '24rpx' }}>
                      <Text
                        style={{
                          display: 'block',
                          fontSize: '20rpx',
                          color: '#737373',
                          letterSpacing: '2rpx',
                          textTransform: 'uppercase',
                        }}
                      >
                        {key}
                      </Text>
                      <View style={{ height: '4rpx' }} />
                      <Text style={{ fontSize: '28rpx', color: '#171717', fontWeight: 600 }}>
                        {String(value)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </SectionCard>

            <View style={{ height: '24rpx' }} />

            <SectionCard title={tt('card.detail.commentsTitle')}>
              {session.isAuthenticated ? (
                <View style={{ marginBottom: '24rpx' }}>
                  <Textarea
                    value={commentContent}
                    placeholder={tt('card.detail.commentPlaceholder')}
                    maxlength={500}
                    onInput={(e) => setCommentContent(e.detail.value)}
                    style={{
                      width: '100%',
                      minHeight: '160rpx',
                      padding: '20rpx',
                      fontSize: '26rpx',
                      background: '#ffffff',
                      border: '1rpx solid #e5e7eb',
                      borderRadius: '12rpx',
                      boxSizing: 'border-box',
                    }}
                  />
                  {commentError ? (
                    <View style={{ marginTop: '12rpx' }}>
                      <Text style={{ color: '#dc2626', fontSize: '24rpx' }}>{commentError}</Text>
                    </View>
                  ) : null}
                  <View
                    style={{
                      marginTop: '16rpx',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: '22rpx', color: '#737373' }}>
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
                <Link to="/pages/auth/login/index" style={{ marginBottom: '24rpx' }}>
                  <View
                    style={{
                      padding: '24rpx',
                      background: '#f1f5f9',
                      borderRadius: '12rpx',
                      textAlign: 'center',
                    }}
                  >
                    <Text style={{ color: '#2563eb', fontSize: '26rpx' }}>
                      {tt('card.detail.loginToComment')}
                    </Text>
                  </View>
                </Link>
              )}

              {commentsLoading ? (
                <View>
                  <Skeleton height="120rpx" />
                  <Skeleton height="120rpx" />
                </View>
              ) : comments.length === 0 ? (
                <Empty title={tt('card.detail.commentEmpty')} />
              ) : (
                <View>
                  {comments.map((comment) => (
                    <View
                      key={comment.id}
                      style={{
                        padding: '20rpx',
                        background: '#ffffff',
                        borderRadius: '12rpx',
                        marginBottom: '16rpx',
                        border: '1rpx solid #f1f5f9',
                      }}
                    >
                      <View
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '22rpx',
                          color: '#737373',
                        }}
                      >
                        <Text style={{ fontWeight: 600, color: '#171717' }}>
                          @{comment.user.username}
                        </Text>
                        <Text>{new Date(comment.createdAt).toLocaleString(locale.locale)}</Text>
                      </View>
                      <View style={{ height: '8rpx' }} />
                      <Text style={{ fontSize: '26rpx', color: '#171717' }}>{comment.content}</Text>
                    </View>
                  ))}
                </View>
              )}
            </SectionCard>
          </View>
        )}
      </View>
    </ScrollView>
  );
});
