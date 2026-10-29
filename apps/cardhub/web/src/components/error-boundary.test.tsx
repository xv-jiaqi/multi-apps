import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, StrictMode } from 'react';
import { stubReload } from '../../test/stub-reload';
import { rootStore } from '../stores/root-store';
import { CHUNK_RETRY_PATH_KEY, ErrorBoundary } from './error-boundary';

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
});

describe('ErrorBoundary fallback', () => {
  it('retries a normal error in place and hides the raw message', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = stubReload();
    let fail = true;

    function Child() {
      if (fail) throw new Error('boundary-secret');
      return <p>recovered</p>;
    }

    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('页面出错了');
    expect(alert).toHaveTextContent('请重试，或返回首页。');
    expect(alert).toHaveClass(
      'mx-auto',
      'mt-6',
      'max-w-md',
      'rounded-lg',
      'border-red-200',
      'bg-red-50',
      'p-6',
      'text-sm',
      'text-red-700',
    );
    expect(alert.className).not.toMatch(/rounded-2xl/);
    expect(alert.parentElement).toHaveClass('app-safe-x');
    const title = screen.getByText('页面出错了');
    expect(title).toHaveClass('font-medium');
    expect(title.className).not.toMatch(/font-semibold/);
    expect(screen.getByText('请重试，或返回首页。')).toHaveClass('mt-1');
    expect(alert).not.toHaveTextContent('Something went wrong');
    expect(alert).not.toHaveTextContent('boundary-secret');
    const retry = screen.getByRole('button', { name: '重试' });
    const home = screen.getByRole('link', { name: '返回首页' });
    expect(home).toHaveAttribute('href', '/');
    expect(retry).toHaveClass(
      'border-red-300',
      'text-red-700',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
    );
    expect(retry.className).not.toMatch(/ring-offset/);
    expect(home).toHaveClass('min-h-6', 'focus-visible:ring-2', 'focus-visible:ring-brand-500');
    expect(home.className).not.toMatch(/ring-offset/);
    expect(retry.parentElement).toHaveClass('mt-4', 'flex', 'flex-wrap', 'items-center', 'gap-3');
    expect(consoleError).toHaveBeenCalled();

    fail = false;
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(reload.reload).not.toHaveBeenCalled();

    consoleError.mockRestore();
    reload.restore();
  });

  it.each([
    [
      'ChunkLoadError',
      () => {
        const error = new Error('missing asset');
        error.name = 'ChunkLoadError';
        return error;
      },
    ],
    [
      'Failed to fetch dynamically imported module',
      () => new Error('Failed to fetch dynamically imported module: /assets/card.js'),
    ],
    [
      'error loading dynamically imported module',
      () => new Error('error loading dynamically imported module: /assets/card.js'),
    ],
    ['Importing a module script failed', () => new TypeError('Importing a module script failed.')],
    ['Unable to preload CSS for', () => new Error('Unable to preload CSS for /assets/card.css')],
    ['Loading chunk', () => new Error('Loading chunk 12 failed.')],
    ['Loading CSS chunk', () => new Error('Loading CSS chunk 4 failed.')],
  ] as const)('reloads when the failure is %s', async (label, makeError) => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = stubReload();

    function Child(): never {
      throw makeError();
    }

    try {
      render(
        <ErrorBoundary>
          <Child />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('alert')).not.toHaveTextContent(label);
      await user.click(screen.getByRole('button', { name: '重试' }));
      expect(reload.reload).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBe(window.location.pathname);
    } finally {
      window.sessionStorage.removeItem(CHUNK_RETRY_PATH_KEY);
      consoleError.mockRestore();
      reload.restore();
    }
  });

  it.each([
    ['a string', 'plain failure'],
    ['null', null],
    ['a plain object', { reason: 'nope' }],
  ] as const)('does not reload when %s is thrown', async (_label, thrown) => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = stubReload();
    let fail = true;

    function Child() {
      if (fail) throw thrown;
      return <p>recovered</p>;
    }

    try {
      render(
        <ErrorBoundary>
          <Child />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      fail = false;
      await user.click(screen.getByRole('button', { name: '重试' }));
      expect(screen.getByText('recovered')).toBeInTheDocument();
      expect(reload.reload).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      reload.restore();
    }
  });

  it('shows only the active language', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Child(): never {
      throw new Error('boundary-secret');
    }

    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );

    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    act(() => {
      rootStore.locale.setLocale('en-US');
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Try again, or go back home.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('页面出错了')).not.toBeInTheDocument();
    expect(screen.queryByText('boundary-secret')).not.toBeInTheDocument();

    consoleError.mockRestore();
  });

  it('focuses retry from the chunk marker and then clears it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.sessionStorage.setItem(CHUNK_RETRY_PATH_KEY, window.location.pathname);

    function Child(): never {
      throw new Error('Loading chunk 12 failed.');
    }

    try {
      render(
        <StrictMode>
          <ErrorBoundary>
            <Child />
          </ErrorBoundary>
        </StrictMode>,
      );
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '重试' }));
      expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBeNull();
    } finally {
      window.sessionStorage.removeItem(CHUNK_RETRY_PATH_KEY);
      consoleError.mockRestore();
    }
  });

  it('reloads a chunk error when sessionStorage cannot be written', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = stubReload();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied');
    });

    function Child(): never {
      const error = new Error('Loading chunk 12 failed.');
      error.name = 'ChunkLoadError';
      throw error;
    }

    try {
      render(
        <ErrorBoundary>
          <Child />
        </ErrorBoundary>,
      );
      await user.click(screen.getByRole('button', { name: '重试' }));
      expect(reload.reload).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
      consoleError.mockRestore();
      reload.restore();
    }
  });

  it('still shows retry when sessionStorage cannot be read', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });

    function Child(): never {
      throw new Error('Loading chunk 12 failed.');
    }

    try {
      render(
        <ErrorBoundary>
          <Child />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
      expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '重试' }));
    } finally {
      getItem.mockRestore();
      consoleError.mockRestore();
    }
  });
});
