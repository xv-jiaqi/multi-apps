import { lazy } from 'react';
import { render, screen } from '@testing-library/react';
import * as Sentry from '@sentry/react';
import { LazyRoute } from './app';
import { rootStore } from './stores/root-store';

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

const chunkError = new Error('Failed to fetch dynamically imported module: /assets/login.js');

const FailedChunk = lazy(() => Promise.reject(chunkError));

function RenderBoom(): never {
  throw new Error('页面自己抛出的错误');
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  delete window.__CARDHUB_CONFIG__;
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureException).mockImplementation(() => 'event-id');
});

describe('LazyRoute chunk failures', () => {
  it('reports a failed route chunk to Sentry with the route name', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.__CARDHUB_CONFIG__ = { SENTRY_DSN: 'https://public@example.invalid/1' };

    render(
      <LazyRoute name="/login">
        <FailedChunk />
      </LazyRoute>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('页面出错了');
    expect(alert).toHaveTextContent('请重试，或返回首页。');
    expect(alert).not.toHaveTextContent('login.js');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(chunkError, { tags: { route: '/login' } });

    consoleError.mockRestore();
  });

  it('stays silent and still shows the error UI when no DSN is configured', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      render(
        <LazyRoute name="/forum/:slug">
          <FailedChunk />
        </LazyRoute>,
      ),
    ).not.toThrow();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('页面出错了');
    expect(Sentry.captureException).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('does not report a render error that is not a chunk load', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.__CARDHUB_CONFIG__ = { SENTRY_DSN: 'https://public@example.invalid/1' };

    render(
      <LazyRoute name="/search">
        <RenderBoom />
      </LazyRoute>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('页面出错了');
    expect(Sentry.captureException).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
