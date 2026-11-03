import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import { ForumNewPage } from './forum-new';
import { SAMPLE_F, expectSampleFDom, sampleFRoots } from '../../test/ch223-sample';

const createMutate = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ forum: { topics: { list: { invalidate: vi.fn() } } } }),
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
    forum: {
      topics: { create: { useMutation: () => ({ mutate: createMutate, isPending: false }) } },
    },
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ForumNewPage />
    </MemoryRouter>,
  );
}

describe('ForumNewPage CH-221 §4 h1', () => {
  beforeEach(() => {
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
  });

  it('renders the page title as the only h1 with the 1e1f1be classes (21-8)', () => {
    renderPage();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('发布新话题');
    expect(h1s[0]!.tagName).toBe('H1');
    expect(h1s[0]!.className).toBe('font-semibold tracking-tight text-2xl');
    expect(h1s[0]).not.toHaveAttribute('tabindex');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('uses the English title in en-US', () => {
    rootStore.locale.setLocale('en-US');
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start a new topic');
  });

  it('keeps one h1 when the preview shows "# x\\n## y" as two h2 (21-8)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('正文'), '# x\n## y');
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'x' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'y' })).toBeInTheDocument();
  });

  it('still shows the h1 for a banned account (4-5)', () => {
    rootStore.session.signIn('token', {
      id: 'u1',
      username: 'qa_user',
      role: 'user',
      bannedAt: '2026-10-27T00:00:00.000Z',
    });
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('发布新话题');
  });
});

describe('ForumNewPage CH-223 preview images', () => {
  beforeEach(() => {
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
    createMutate.mockReset();
  });

  it('previews sample F with the https rule and posts the body unchanged (23-1, 23-9)', async () => {
    const user = userEvent.setup();
    renderPage();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'CH-223 sample F' } });
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: SAMPLE_F } });
    await user.click(screen.getByRole('button', { name: '预览' }));

    const roots = sampleFRoots();
    expect(roots).toHaveLength(1);
    expectSampleFDom(roots[0]!);

    const submit = screen.getByRole('button', { name: '发布话题' });
    expect(submit).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(submit);
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toMatchObject({ body: SAMPLE_F });
  });
});
