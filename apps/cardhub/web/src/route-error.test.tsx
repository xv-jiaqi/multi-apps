import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Sentry from '@sentry/react';
import { act, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from './app';
import { TrpcProvider } from './lib/trpc';
import { rootStore } from './stores/root-store';

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

function ThrowOnRender(): never {
  throw new Error('首页渲染失败');
}

function stubReload() {
  const reload = vi.fn();
  const descriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload },
  });
  return {
    reload,
    restore() {
      if (descriptor) Object.defineProperty(window, 'location', descriptor);
    },
  };
}

function renderBoom(element: ReactNode) {
  const layout = appRoutes[0];
  if (!layout) throw new Error('missing layout route');
  const router = createMemoryRouter(
    [
      {
        element: layout.element,
        errorElement: layout.errorElement,
        children: [{ path: '/boom', element }],
      },
    ],
    { initialEntries: ['/boom'] },
  );
  render(
    <TrpcProvider>
      <RouterProvider router={router} />
    </TrpcProvider>,
  );
}

beforeEach(() => {
  rootStore.session.signOut();
  rootStore.locale.setLocale('zh-CN');
  window.__CARDHUB_CONFIG__ = { SENTRY_DSN: 'https://public@example.invalid/1' };
  vi.mocked(Sentry.captureException).mockClear();
});

afterEach(() => {
  delete window.__CARDHUB_CONFIG__;
});

describe('route error element', () => {
  it('shows 页面出错了 when a child route throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBoom(<ThrowOnRender />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('页面出错了');
    expect(screen.getByRole('button', { name: '重试' })).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
    );
    expect(alert).not.toHaveTextContent('首页渲染失败');
    expect(alert).not.toHaveTextContent('Something went wrong');
    expect(
      screen.queryByRole('heading', { name: 'Unexpected Application Error!' }),
    ).not.toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: '首页渲染失败' }),
    );
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: '首页渲染失败' }));
    consoleError.mockRestore();
  });

  it('retries a normal error through the router and hides the raw message', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = stubReload();
    let fail = true;

    function Child() {
      if (fail) throw new Error('route-secret');
      return <p>route-ok</p>;
    }

    renderBoom(<Child />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('route-secret');

    fail = false;
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('route-ok')).toBeInTheDocument();
    expect(reload.reload).not.toHaveBeenCalled();

    consoleError.mockRestore();
    reload.restore();
  });

  it('reloads the page when a dynamic import fails', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = stubReload();

    function Child(): never {
      throw new Error('Failed to fetch dynamically imported module: /assets/card.js');
    }

    renderBoom(<Child />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('card.js');
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(reload.reload).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalled();

    consoleError.mockRestore();
    reload.restore();
  });

  it('shows only the active language', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBoom(<ThrowOnRender />);

    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    act(() => {
      rootStore.locale.setLocale('en-US');
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Try again, or go back home.');
    expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('页面出错了')).not.toBeInTheDocument();
    expect(screen.queryByText('首页渲染失败')).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});
