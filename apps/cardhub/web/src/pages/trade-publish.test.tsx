import { APP_ERROR_CODES } from '@repo/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';
import { TradePublishPage } from './trade-publish';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

const publishHarness = vi.hoisted(() => ({
  onError: undefined as
    | ((error: { message: string; data?: { code?: string; appCode?: string } }) => void)
    | undefined,
}));

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({
      listings: {
        list: { invalidate: vi.fn() },
        byCard: { invalidate: vi.fn() },
      },
    }),
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          isError: false,
          isSuccess: false,
          refetch: vi.fn(),
        }),
      },
    },
    cards: {
      bySlug: {
        useQuery: (input: { slug: string }, options?: { enabled?: boolean }) =>
          options?.enabled && input.slug
            ? {
                data: {
                  slug: input.slug,
                  name: '极光骑士',
                  rarity: 'rare',
                  imageUrl: null,
                  seriesSlug: 'starter',
                  seriesTitle: '启程',
                },
                isLoading: false,
                isError: false,
              }
            : { data: undefined, isLoading: false, isError: false },
      },
      search: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    listings: {
      publish: {
        useMutation: (options?: {
          onError?: (error: {
            message: string;
            data?: { code?: string; appCode?: string };
          }) => void;
        }) => {
          publishHarness.onError = options?.onError;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));

describe('TradePublishPage', () => {
  beforeEach(() => {
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
  });

  it('uses a real newline in the image placeholder and field errors for an empty contact', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/trade/new']}>
        <TradePublishPage />
      </MemoryRouter>,
    );

    const images = screen.getByRole('textbox', { name: /实物图链接/ });
    expect(images).toHaveProperty('placeholder', 'https://...\nhttps://...');
    expect(images.getAttribute('placeholder')).not.toContain('\\n');

    const contact = screen.getByRole('textbox', { name: /联系方式/ });
    expect(contact).not.toBeRequired();
    expect(contact.closest('form')).toHaveAttribute('novalidate');

    await user.click(screen.getByRole('button', { name: '发布意向' }));
    expect(await screen.findByText('请选择一张卡牌')).toBeInTheDocument();
    expect(screen.getByText('联系方式需要 2–200 个字')).toBeInTheDocument();
    expect(document.getElementById('trade-card')).toHaveFocus();
  });

  it('focuses the contact field when the card is already selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/trade/new?cardSlug=aurora-knight']}>
        <TradePublishPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('极光骑士')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发布意向' }));
    expect(await screen.findByText('联系方式需要 2–200 个字')).toBeInTheDocument();
    expect(screen.queryByText('请选择一张卡牌')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /联系方式/ })).toHaveFocus();
  });

  it('shows the shared rate-limit copy instead of the raw error', async () => {
    render(
      <MemoryRouter initialEntries={['/trade/new']}>
        <TradePublishPage />
      </MemoryRouter>,
    );

    act(() => {
      publishHarness.onError?.({
        message: 'Too many requests',
        data: {
          code: 'TOO_MANY_REQUESTS',
          appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
        },
      });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('发布太频繁，请稍后再试');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Too many requests');
  });

  it('clears the session and returns to login when publishing is rejected', () => {
    function Where() {
      const location = useLocation();
      return (
        <p data-testid="where">
          {location.pathname}|{JSON.stringify(location.state)}
        </p>
      );
    }

    render(
      <MemoryRouter initialEntries={['/trade/new']}>
        <TradePublishPage />
        <Where />
      </MemoryRouter>,
    );

    act(() => {
      publishHarness.onError?.({
        message: 'UNAUTHORIZED',
        data: { code: 'UNAUTHORIZED', appCode: APP_ERROR_CODES.UNAUTHORIZED },
      });
    });

    expect(rootStore.session.token).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/login|{"from":"/trade/new","notice":"sessionExpired"}',
    );
    expect(screen.queryByText('UNAUTHORIZED')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to a text link when a preview image fails to load', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/trade/new']}>
        <TradePublishPage />
      </MemoryRouter>,
    );

    await user.type(
      screen.getByRole('textbox', { name: /实物图链接/ }),
      'https://example.com/broken.png',
    );

    const img = document.querySelector('img[src="https://example.com/broken.png"]');
    if (!(img instanceof HTMLImageElement)) throw new Error('preview img is missing');
    fireEvent.error(img);

    const fallback = await screen.findByRole('link', { name: '图片 1' });
    expect(fallback).toHaveAttribute('href', 'https://example.com/broken.png');
    expect(document.querySelector('img[src="https://example.com/broken.png"]')).toBeNull();
  });

  it('falls back when a cached preview already has no natural width', async () => {
    const user = userEvent.setup();
    const imageProto = HTMLImageElement.prototype;
    const complete = Object.getOwnPropertyDescriptor(imageProto, 'complete');
    const naturalWidth = Object.getOwnPropertyDescriptor(imageProto, 'naturalWidth');
    Object.defineProperty(imageProto, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(imageProto, 'naturalWidth', { configurable: true, get: () => 0 });
    try {
      render(
        <MemoryRouter initialEntries={['/trade/new']}>
          <TradePublishPage />
        </MemoryRouter>,
      );
      await user.type(
        screen.getByRole('textbox', { name: /实物图链接/ }),
        'https://example.com/cached.png',
      );
      const fallback = await screen.findByRole('link', { name: '图片 1' });
      expect(fallback).toHaveAttribute('href', 'https://example.com/cached.png');
      expect(document.querySelector('img[src="https://example.com/cached.png"]')).toBeNull();
    } finally {
      if (complete) Object.defineProperty(imageProto, 'complete', complete);
      if (naturalWidth) Object.defineProperty(imageProto, 'naturalWidth', naturalWidth);
    }
  });

  it('rejects an image link longer than 2048 characters in shared copy', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/trade/new?cardSlug=aurora-knight']}>
        <TradePublishPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('极光骑士')).toBeInTheDocument();
    const images = screen.getByRole('textbox', { name: /实物图链接/ });
    fireEvent.change(images, {
      target: { value: `https://example.com/${'a'.repeat(2048)}` },
    });
    await user.type(screen.getByRole('textbox', { name: /联系方式/ }), 'wechat');
    await user.click(screen.getByRole('button', { name: '发布意向' }));

    expect(screen.getByText('图片链接最长 2048 个字符')).toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
    expect(images).toHaveFocus();
  });

  it('rejects a price string longer than 64 characters in shared copy', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/trade/new?cardSlug=aurora-knight']}>
        <TradePublishPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('极光骑士')).toBeInTheDocument();
    const price = screen.getByRole('textbox', { name: '价格（可空）' });
    fireEvent.change(price, { target: { value: '0'.repeat(65) } });
    await user.type(screen.getByRole('textbox', { name: /联系方式/ }), 'wechat');
    await user.click(screen.getByRole('button', { name: '发布意向' }));

    expect(screen.getByText('价格最长 64 个字符')).toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
    expect(price).toHaveFocus();
  });
});
