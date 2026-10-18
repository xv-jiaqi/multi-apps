import { render, screen } from '@testing-library/react';
import * as Sentry from '@sentry/react';
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

beforeEach(() => {
  rootStore.session.signOut();
  window.__CARDHUB_CONFIG__ = { SENTRY_DSN: 'https://public@example.invalid/1' };
  vi.mocked(Sentry.captureException).mockClear();
});

afterEach(() => {
  delete window.__CARDHUB_CONFIG__;
});

describe('route error element', () => {
  it('shows 出现了错误 when a child route throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layout = appRoutes[0];
    if (!layout) throw new Error('missing layout route');
    const router = createMemoryRouter(
      [
        {
          element: layout.element,
          errorElement: layout.errorElement,
          children: [{ path: '/boom', element: <ThrowOnRender /> }],
        },
      ],
      { initialEntries: ['/boom'] },
    );

    render(
      <TrpcProvider>
        <RouterProvider router={router} />
      </TrpcProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('出现了错误');
    expect(
      screen.queryByRole('heading', { name: 'Unexpected Application Error!' }),
    ).not.toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: '首页渲染失败' }),
    );
    consoleError.mockRestore();
  });
});
