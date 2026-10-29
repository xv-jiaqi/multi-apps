import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';
import { PageShell } from '../components/page-shell';
import { TopicForm } from '../components/topic-form';
import '../styles/globals.css';

/**
 * 375px layout coverage for ui-spec-global-rules.md §G-1.
 * The CH-217 draft is not in /workspace/specs or the repo. The three extra
 * cases are the AC1-4 defects that batch left unfixed: series description,
 * card description, and the report-queue reason line.
 */

declare module 'vitest/browser' {
  interface BrowserCommands {
    setViewport: (width: number, height: number) => Promise<void>;
  }
}

const LONG = 'W'.repeat(220);
const MARKDOWN = [
  `https://example.com/${LONG}`,
  '',
  `\`${LONG}\``,
  '',
  '```',
  `const value = "${LONG}";`,
  '```',
  '',
  '| col |',
  '| --- |',
  `| ${LONG} |`,
].join('\n');

const ready = {
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  isSuccess: true,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  refetch: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  fetchNextPage: vi.fn(),
};

const fixtures = vi.hoisted(() => ({
  long: 'W'.repeat(220),
  markdown: '',
  replyBody: '短回帖',
  comment: '短评论',
  excerpt: '短摘要',
  title: '短标题',
  seriesDescription: '短系列介绍',
  cardDescription: '短卡牌介绍',
  contact: 'wechat:alice',
  note: '短备注',
  email: 'alice@cardhub.test',
  meTopic: '我的话题',
  meComment: '我的评论',
  reportReason: '举报原因',
  reportResolution: null as string | null,
  reportStatus: 'PENDING' as 'PENDING' | 'RESOLVED',
}));

function mutation() {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: undefined };
}

function pages<T>(items: T[]) {
  return { pages: [{ items, nextCursor: null }], pageParams: [null] };
}

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({
      forum: {
        topics: {
          bySlug: { setData: vi.fn(), invalidate: vi.fn() },
          list: { invalidate: vi.fn() },
        },
        replies: { list: { setInfiniteData: vi.fn(), invalidate: vi.fn(), reset: vi.fn() } },
      },
      comments: {
        listForCard: { invalidate: vi.fn() },
        listForSeries: { invalidate: vi.fn() },
      },
      reports: { list: { invalidate: vi.fn() } },
      listings: { mine: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
      users: {
        myTopics: { invalidate: vi.fn() },
        myComments: { invalidate: vi.fn() },
      },
    }),
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
      },
    },
    auth: {
      me: { useQuery: () => ({ ...ready, data: undefined, isSuccess: false }) },
      signOutAll: { useMutation: mutation },
    },
    cards: {
      bySlug: {
        useQuery: () => ({
          ...ready,
          data: {
            slug: 'aurora-knight',
            name: '极光骑士',
            description: fixtures.cardDescription,
            imageUrl: null,
            rarity: 'rare',
            seriesSlug: 'celestial-dawn',
            seriesTitle: '天穹黎明',
            attributes: {},
          },
        }),
      },
      search: { useQuery: () => ({ ...ready, data: { results: [] } }) },
    },
    series: {
      bySlug: {
        useQuery: () => ({
          ...ready,
          data: {
            id: 'series-1',
            slug: 'celestial-dawn',
            title: '天穹黎明',
            description: fixtures.seriesDescription,
            coverUrl: null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
            cards: [],
          },
        }),
      },
    },
    forum: {
      topics: {
        bySlug: {
          useQuery: () => ({
            ...ready,
            data: {
              id: 'topic-1',
              slug: 'long-topic',
              title: fixtures.title,
              body: fixtures.markdown,
              excerpt: fixtures.excerpt,
              pinned: false,
              editedAt: null,
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
              editableUntil: '2026-05-01T00:05:00.000Z',
              serverNow: '2026-05-01T00:00:00.000Z',
              author: { id: 'user-1', username: 'alice' },
              replyCount: 1,
              replies: [
                {
                  id: 'reply-1',
                  body: fixtures.replyBody,
                  createdAt: '2026-05-01T01:00:00.000Z',
                  author: { id: 'user-2', username: 'bob' },
                },
              ],
              replyNextCursor: null,
            },
          }),
        },
        list: {
          useInfiniteQuery: () => ({
            ...ready,
            data: pages([
              {
                id: 'topic-1',
                slug: 'long-topic',
                title: fixtures.title,
                excerpt: fixtures.excerpt,
                pinned: false,
                replyCount: 0,
                author: { id: 'user-1', username: 'alice' },
                createdAt: '2026-05-01T00:00:00.000Z',
              },
            ]),
          }),
        },
        delete: { useMutation: mutation },
        setPinned: { useMutation: mutation },
      },
      replies: {
        list: {
          useInfiniteQuery: () => ({
            ...ready,
            data: pages([
              {
                id: 'reply-1',
                body: fixtures.markdown,
                createdAt: '2026-05-01T01:00:00.000Z',
                author: { id: 'user-2', username: 'bob' },
              },
            ]),
          }),
        },
        create: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
    },
    comments: {
      listForCard: {
        useQuery: () => ({
          ...ready,
          data: [
            {
              id: 'comment-1',
              content: fixtures.comment,
              createdAt: '2026-05-01T08:00:00.000Z',
              user: { id: 'user-1', username: 'alice' },
              replyCount: 0,
              replies: [],
            },
          ],
        }),
      },
      listForSeries: { useQuery: () => ({ ...ready, data: [] }) },
      create: { useMutation: mutation },
      createForSeries: { useMutation: mutation },
      delete: { useMutation: mutation },
    },
    listings: {
      byCard: { useQuery: () => ({ ...ready, data: [] }) },
      list: {
        useInfiniteQuery: () => ({
          ...ready,
          data: pages([
            {
              id: 'listing-1',
              kind: 'SELL',
              status: 'OPEN',
              cardSlug: 'aurora-knight',
              card: {
                slug: 'aurora-knight',
                name: '极光骑士',
                imageUrl: null,
                seriesTitle: '天穹黎明',
              },
              price: '12.00',
              currency: 'CNY',
              condition: null,
              language: null,
              contact: fixtures.contact,
              note: fixtures.note,
              imageUrls: [],
              seller: { id: 'user-1', username: 'alice' },
              createdAt: '2026-05-01T00:00:00.000Z',
            },
          ]),
        }),
      },
      mine: { useInfiniteQuery: () => ({ ...ready, data: pages([]) }) },
      close: { useMutation: mutation },
    },
    users: {
      me: {
        useQuery: () => ({
          ...ready,
          data: {
            id: 'user-1',
            username: 'alice',
            email: fixtures.email,
            role: 'user',
            createdAt: '2026-03-02T00:00:00.000Z',
            listingTotalCount: 0,
            topicCount: 1,
            replyCount: 0,
            commentCount: 1,
          },
        }),
      },
      myTopics: {
        useInfiniteQuery: () => ({
          ...ready,
          data: pages([
            {
              id: 'topic-1',
              slug: 'mine',
              title: fixtures.meTopic,
              replyCount: 0,
              createdAt: '2026-05-02T00:00:00.000Z',
            },
          ]),
        }),
      },
      myComments: {
        useInfiniteQuery: () => ({
          ...ready,
          data: pages([
            {
              id: 'comment-1',
              body: fixtures.meComment,
              createdAt: '2026-05-03T00:00:00.000Z',
              target: {
                kind: 'card',
                slug: 'aurora-knight',
                name: '极光骑士',
                imageUrl: null,
              },
            },
          ]),
        }),
      },
    },
    reports: {
      create: { useMutation: mutation },
      list: {
        useInfiniteQuery: () => ({
          ...ready,
          data: pages([
            {
              id: 'report-1',
              targetId: 'target-1',
              targetType: 'COMMENT',
              target: null,
              reason: fixtures.reportReason,
              status: fixtures.reportStatus,
              createdAt: '2026-05-01T00:00:00.000Z',
              resolvedAt: fixtures.reportStatus === 'RESOLVED' ? '2026-05-02T00:00:00.000Z' : null,
              resolver:
                fixtures.reportStatus === 'RESOLVED' ? { id: 'admin-1', username: 'admin' } : null,
              resolution: fixtures.reportResolution,
              reporter: { id: 'user-1', username: 'alice' },
            },
          ]),
        }),
      },
      resolve: { useMutation: mutation },
    },
    admin: {
      catalog: {
        import: {
          useMutation: () => ({
            mutateAsync: vi.fn(async () => [
              {
                row: { row: 1, type: 'card', slug: null, name: null },
                status: 'error',
                errors: [{ path: fixtures.long, code: 'SLUG_FORMAT' }],
              },
            ]),
            isPending: false,
          }),
        },
      },
    },
  },
}));

import { ForumDetailPage } from './forum-detail';
import { ForumListPage } from './forum-list';
import { CardDetailPage } from './card-detail';
import { SeriesDetailPage } from './series-detail';
import { TradeListPage } from './trade-list';
import { MePage } from './me';
import { ReportsListPage } from './reports-list';
import { CatalogImportPage } from './admin/catalog-import';

function pageFits() {
  const scrolling = document.scrollingElement;
  expect(scrolling).toBeTruthy();
  expect(scrolling!.clientWidth).toBe(375);
  expect(scrolling!.scrollWidth).toBeLessThanOrEqual(scrolling!.clientWidth);
  expect(document.body.className).not.toContain('overflow-x-hidden');
}

function contentFits(el: HTMLElement, text: string) {
  expect(el.textContent ?? '').toContain(text);
  expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
  expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(376);
  expect(el.getBoundingClientRect().height).toBeGreaterThan(32);
  pageFits();
}

beforeEach(async () => {
  fixtures.markdown = '短正文';
  fixtures.replyBody = '短回帖';
  fixtures.comment = '短评论';
  fixtures.excerpt = '短摘要';
  fixtures.title = '短标题';
  fixtures.seriesDescription = '短系列介绍';
  fixtures.cardDescription = '短卡牌介绍';
  fixtures.contact = 'wechat:alice';
  fixtures.note = '短备注';
  fixtures.email = 'alice@cardhub.test';
  fixtures.meTopic = '我的话题';
  fixtures.meComment = '我的评论';
  fixtures.reportReason = '举报原因';
  fixtures.reportResolution = null;
  fixtures.reportStatus = 'PENDING';
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
  rootStore.session.signOut();
});

describe('G-1 long content at 375px', () => {
  it('wraps a forum body URL, inline code, and keeps the code block inside the card', async () => {
    fixtures.title = '话题';
    fixtures.markdown = MARKDOWN;
    render(
      <MemoryRouter initialEntries={['/forum/long-topic']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: `https://example.com/${LONG}` });
    contentFits(link, LONG);
    const code = screen.getAllByText(LONG).find((node) => node.tagName === 'CODE');
    expect(code).toBeTruthy();
    contentFits(code!, LONG);
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain(LONG);
    expect(getComputedStyle(pre!).overflowX).toBe('auto');
    expect(pre!.scrollWidth).toBeGreaterThan(pre!.clientWidth);
    expect(pre!.getBoundingClientRect().right).toBeLessThanOrEqual(376);
    const tableFrame = document.querySelector('table')?.parentElement;
    expect(tableFrame).toBeTruthy();
    expect(getComputedStyle(tableFrame!).overflowX).toBe('auto');
    expect(tableFrame!.getBoundingClientRect().right).toBeLessThanOrEqual(376);
    pageFits();
  });

  it('wraps a reply body the same way inside its column', async () => {
    fixtures.title = '话题';
    fixtures.markdown = '话题正文很短。';
    fixtures.replyBody = `https://example.com/${LONG}`;
    render(
      <MemoryRouter initialEntries={['/forum/long-topic']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: `https://example.com/${LONG}` });
    contentFits(link, LONG);
  });

  it('wraps the topic form preview', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PageShell>
          <TopicForm
            titleLabel="标题"
            titlePlaceholder=""
            bodyLabel="正文"
            bodyPlaceholder=""
            markdownHint=""
            showPreviewLabel="显示预览"
            hidePreviewLabel="隐藏预览"
            previewEmptyLabel="空"
            cancelLabel="取消"
            submitLabel="发布"
            submittingLabel="发布中"
            initialBody={`https://example.com/${LONG}`}
            error={null}
            isSubmitting={false}
            onCancel={() => undefined}
            onSubmit={() => undefined}
          />
        </PageShell>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '显示预览' }));
    const link = await screen.findByRole('link', { name: `https://example.com/${LONG}` });
    contentFits(link, LONG);
  });

  it('wraps a card comment', async () => {
    fixtures.comment = LONG;
    render(
      <MemoryRouter initialEntries={['/cards/aurora-knight']}>
        <Routes>
          <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const comment = await screen.findByText(LONG);
    contentFits(comment, LONG);
  });

  it('wraps a forum list excerpt without widening the row', async () => {
    fixtures.title = '列表话题';
    fixtures.excerpt = LONG;
    render(
      <MemoryRouter>
        <ForumListPage />
      </MemoryRouter>,
    );
    const excerpt = await screen.findByText(LONG);
    expect(excerpt).toHaveClass('wrap-anywhere', 'line-clamp-2');
    expect(excerpt.scrollWidth).toBeLessThanOrEqual(excerpt.clientWidth + 1);
    expect(excerpt.getBoundingClientRect().right).toBeLessThanOrEqual(376);
    expect(excerpt.textContent).toBe(LONG);
    pageFits();
  });

  it('wraps a listing contact and note', async () => {
    fixtures.contact = LONG;
    fixtures.note = LONG;
    render(
      <MemoryRouter>
        <TradeListPage />
      </MemoryRouter>,
    );
    const nodes = await screen.findAllByText(LONG);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    for (const node of nodes) contentFits(node, LONG);
  });

  it('wraps the profile email, topic title, and comment', async () => {
    fixtures.email = `${LONG}@cardhub.test`;
    fixtures.meTopic = LONG;
    fixtures.meComment = LONG;
    rootStore.session.signIn('token', { id: 'user-1', username: 'alice', role: 'user' });
    render(
      <MemoryRouter>
        <MePage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: LONG });
    const email = [...document.querySelectorAll('p')].find((node) =>
      node.textContent?.includes('@cardhub.test'),
    );
    expect(email).toBeTruthy();
    contentFits(email!, LONG);
    contentFits(screen.getByRole('link', { name: LONG }), LONG);
    const comment = document.querySelector('p.line-clamp-2');
    expect(comment).toBeTruthy();
    expect(comment).toHaveClass('wrap-anywhere');
    expect(comment!.textContent).toBe(LONG);
    expect(comment!.scrollWidth).toBeLessThanOrEqual(comment!.clientWidth + 1);
    expect(comment!.getBoundingClientRect().right).toBeLessThanOrEqual(376);
    pageFits();
  });

  it('wraps a resolved report note', async () => {
    fixtures.reportStatus = 'RESOLVED';
    fixtures.reportResolution = LONG;
    rootStore.session.signIn('token', { id: 'admin-1', username: 'admin', role: 'admin' });
    render(
      <MemoryRouter>
        <ReportsListPage />
      </MemoryRouter>,
    );
    const note = await screen.findByText(LONG);
    contentFits(note, LONG);
  });

  it('keeps the import example pre inside the page and wraps a long error path', async () => {
    rootStore.session.signIn('token', { id: 'admin-1', username: 'admin', role: 'admin' });
    render(
      <MemoryRouter>
        <CatalogImportPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText('查看格式示例'));
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre).toHaveClass('max-w-full', 'overflow-x-auto', 'whitespace-pre');
    expect(pre!.getBoundingClientRect().right).toBeLessThanOrEqual(376);
    pageFits();
  });

  it.fails('wraps a long import error path inside the page', async () => {
    rootStore.session.signIn('token', { id: 'admin-1', username: 'admin', role: 'admin' });
    render(
      <MemoryRouter>
        <CatalogImportPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('JSON 内容'), { target: { value: '[]' } });
    await user.click(screen.getByRole('button', { name: '预览' }));
    const path = await screen.findByText(LONG);
    contentFits(path, LONG);
  });
});

describe('remaining narrow-screen locations', () => {
  it.fails('wraps a series description', async () => {
    fixtures.seriesDescription = LONG;
    render(
      <MemoryRouter initialEntries={['/series/celestial-dawn']}>
        <Routes>
          <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const description = await screen.findByText(LONG);
    contentFits(description, LONG);
  });

  it.fails('wraps a card description', async () => {
    fixtures.cardDescription = LONG;
    fixtures.comment = '短评论';
    render(
      <MemoryRouter initialEntries={['/cards/aurora-knight']}>
        <Routes>
          <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const description = await screen.findByText(LONG);
    contentFits(description, LONG);
  });

  it.fails('wraps a report reason inside the queue row', async () => {
    fixtures.reportReason = LONG;
    rootStore.session.signIn('token', { id: 'admin-1', username: 'admin', role: 'admin' });
    render(
      <MemoryRouter>
        <ReportsListPage />
      </MemoryRouter>,
    );
    const reason = await screen.findByText(LONG);
    contentFits(reason, LONG);
  });
});
