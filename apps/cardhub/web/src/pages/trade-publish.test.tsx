import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      listings: {
        list: { invalidate: vi.fn() },
        byCard: { invalidate: vi.fn() },
      },
    }),
    cards: {
      bySlug: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
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
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
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
});
