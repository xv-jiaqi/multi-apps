import { render, screen } from '@testing-library/react';
import * as Sentry from '@sentry/react';
import { LazyRoute } from './app';
import { rootStore } from './stores/root-store';

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

function ChunkLoadFailure(): never {
  throw new Error('Failed to fetch dynamically imported module: /assets/series.js');
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  vi.mocked(Sentry.captureException).mockClear();
  delete window.__CARDHUB_CONFIG__;
});

afterEach(() => {
  delete window.__CARDHUB_CONFIG__;
});

describe('LazyRoute load failure', () => {
  it('reports the failed dynamic import to Sentry when a DSN is set', () => {
    window.__CARDHUB_CONFIG__ = { SENTRY_DSN: 'https://public@example.invalid/1' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <LazyRoute>
        <ChunkLoadFailure />
      </LazyRoute>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('页面出错了');
    expect(screen.getByRole('alert')).not.toHaveTextContent('series.js');
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to fetch dynamically imported module: /assets/series.js',
      }),
      { extra: { componentStack: expect.any(String) } },
    );

    consoleError.mockRestore();
  });

  it('does not call Sentry when no DSN is configured', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <LazyRoute>
        <ChunkLoadFailure />
      </LazyRoute>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(Sentry.captureException).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
