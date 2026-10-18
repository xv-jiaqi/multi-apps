import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { rootStore } from '../stores/root-store';
import { ErrorBoundary } from './error-boundary';

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
    expect(alert).not.toHaveTextContent('Something went wrong');
    expect(alert).not.toHaveTextContent('boundary-secret');
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: '重试' })).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
    );
    expect(consoleError).toHaveBeenCalled();

    fail = false;
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(reload.reload).not.toHaveBeenCalled();

    consoleError.mockRestore();
    reload.restore();
  });

  it('reloads the page when a chunk fails to load', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = stubReload();

    function Child(): never {
      const error = new Error('Loading chunk 12 failed');
      error.name = 'ChunkLoadError';
      throw error;
    }

    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).not.toHaveTextContent('Loading chunk 12 failed');
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(reload.reload).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
    reload.restore();
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
});
