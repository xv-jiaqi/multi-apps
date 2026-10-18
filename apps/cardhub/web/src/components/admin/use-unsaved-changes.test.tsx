import '../../pages/admin/test-dom';
import { act, useEffect, useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { observer } from 'mobx-react-lite';
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from 'react-router';
import { rootStore, useStores } from '../../stores/root-store';
import { useUnsavedChanges } from './use-unsaved-changes';

function Harness() {
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const unsaved = useUnsavedChanges(value.length > 0);
  return (
    <>
      <label>
        草稿
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <Link to="/elsewhere">离开</Link>
      <button
        type="button"
        onClick={() => {
          unsaved.allowLeave();
          navigate('/saved');
        }}
      >
        保存
      </button>
      {unsaved.dialog}
    </>
  );
}

function renderHarness(entries: string[] = ['/form']) {
  const router = createMemoryRouter(
    [
      { path: '/form', element: <Harness /> },
      { path: '/elsewhere', element: <h1>别处</h1> },
      { path: '/saved', element: <h1>已保存</h1> },
      { path: '/start', element: <h1>起点</h1> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

function dispatchBeforeUnload() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
});

describe('useUnsavedChanges', () => {
  it('asks before an in-app link when the form is dirty and keeps the edit on cancel', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => false);
    const { router } = renderHarness();
    const input = screen.getByRole('textbox', { name: '草稿' });

    await user.type(input, '草稿');
    await user.click(screen.getByRole('link', { name: '离开' }));

    const dialog = screen.getByRole('alertdialog', { name: '放弃未保存的修改？' });
    expect(dialog).toHaveTextContent('离开这个页面后，刚才的修改不会保存。');
    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus();
    expect(router.state.location.pathname).toBe('/form');
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '继续编辑' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(input).toHaveValue('草稿');
    expect(router.state.location.pathname).toBe('/form');
    confirmSpy.mockRestore();
  });

  it('leaves when the discard action is confirmed', async () => {
    const user = userEvent.setup();
    const { router } = renderHarness();
    await user.type(screen.getByRole('textbox', { name: '草稿' }), '草稿');
    await user.click(screen.getByRole('link', { name: '离开' }));
    await user.click(screen.getByRole('button', { name: '放弃修改' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '别处' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/elsewhere');
  });

  it('does not ask when nothing changed', async () => {
    const user = userEvent.setup();
    const { router } = renderHarness();

    await user.click(screen.getByRole('link', { name: '离开' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/elsewhere');
  });

  it('does not ask after a value is typed and then removed', async () => {
    const user = userEvent.setup();
    const { router } = renderHarness();
    const input = screen.getByRole('textbox', { name: '草稿' });

    await user.type(input, 'a');
    await user.type(input, '{Backspace}');
    await user.click(screen.getByRole('link', { name: '离开' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/elsewhere');
  });

  it('does not ask after a successful save navigates away', async () => {
    const user = userEvent.setup();
    const { router } = renderHarness();
    await user.type(screen.getByRole('textbox', { name: '草稿' }), '草稿');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '已保存' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/saved');
  });

  it('registers beforeunload only while the form is dirty', async () => {
    const user = userEvent.setup();
    const added: EventListener[] = [];
    const removed: EventListener[] = [];
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    const addSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'beforeunload' && typeof listener === 'function') added.push(listener);
        originalAdd(type, listener, options);
      });
    const removeSpy = vi
      .spyOn(window, 'removeEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'beforeunload' && typeof listener === 'function') removed.push(listener);
        originalRemove(type, listener, options);
      });

    renderHarness();
    expect(added).toHaveLength(0);
    expect(dispatchBeforeUnload()).toBe(false);

    await user.type(screen.getByRole('textbox', { name: '草稿' }), 'a');
    expect(added).toHaveLength(1);
    expect(dispatchBeforeUnload()).toBe(true);

    await user.type(screen.getByRole('textbox', { name: '草稿' }), '{Backspace}');
    expect(removed).toEqual(added);
    expect(dispatchBeforeUnload()).toBe(false);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('blocks browser back, stays put on cancel, and leaves on confirm', async () => {
    const user = userEvent.setup();
    const { router } = renderHarness(['/start', '/form']);
    await user.type(screen.getByRole('textbox', { name: '草稿' }), '草稿');

    await act(async () => {
      await router.navigate(-1);
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/form');
    const key = router.state.location.key;

    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/form');
    expect(router.state.location.key).toBe(key);
    expect(screen.getByRole('textbox', { name: '草稿' })).toHaveValue('草稿');

    await act(async () => {
      await router.navigate(1);
    });
    expect(router.state.location.pathname).toBe('/form');
    expect(router.state.location.key).toBe(key);

    await act(async () => {
      await router.navigate(-1);
    });
    await user.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(screen.getByRole('heading', { name: '起点' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/start');
  });

  it('returns focus to the trigger when Escape dismisses the dialog', async () => {
    const user = userEvent.setup();
    const { router } = renderHarness();
    const input = screen.getByRole('textbox', { name: '草稿' });
    await user.type(input, '草稿');
    input.focus();

    await act(async () => {
      await router.navigate('/elsewhere');
    });

    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('草稿');
    expect(router.state.location.pathname).toBe('/form');
  });

  it('uses the English copy when the locale is en-US', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('en-US');
    renderHarness();
    await user.type(screen.getByRole('textbox', { name: '草稿' }), 'draft');
    await user.click(screen.getByRole('link', { name: '离开' }));

    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toHaveTextContent(
      "If you leave this page, your changes won't be saved.",
    );
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
  });

  it('lets a permission-loss or session-expiry redirect through and still asks while the admin session is intact', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
    const router = createMemoryRouter(
      [
        { path: '/form', element: <SessionRedirectHarness /> },
        { path: '/elsewhere', element: <h1>别处</h1> },
        { path: '/revoked', element: <h1>权限已撤销</h1> },
        { path: '/login', element: <h1>登录</h1> },
      ],
      { initialEntries: ['/form'] },
    );
    render(<RouterProvider router={router} />);
    await user.type(screen.getByRole('textbox', { name: '草稿' }), '草稿');

    await user.click(screen.getByRole('link', { name: '离开' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.pathname).toBe('/form');

    act(() => {
      rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'user' });
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '权限已撤销' })).toBeInTheDocument();
    rootStore.session.signOut();
  });

  it('lets a session-expiry redirect through without asking', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
    const router = createMemoryRouter(
      [
        { path: '/form', element: <SessionRedirectHarness /> },
        { path: '/login', element: <h1>登录</h1> },
        { path: '/revoked', element: <h1>权限已撤销</h1> },
        { path: '/elsewhere', element: <h1>别处</h1> },
      ],
      { initialEntries: ['/form'] },
    );
    render(<RouterProvider router={router} />);
    await user.type(screen.getByRole('textbox', { name: '草稿' }), '草稿');

    act(() => {
      rootStore.session.signOut();
    });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('asks again after a bypassed save navigation', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          element: <StayMountedEditor />,
          children: [
            { path: '/form', element: <h1>表单</h1> },
            { path: '/next', element: <h1>下一张</h1> },
            { path: '/elsewhere', element: <h1>别处</h1> },
          ],
        },
      ],
      { initialEntries: ['/form'] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('button', { name: '保存并新建' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '下一张' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '离开' }));
    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/next');
  });
});

const SessionRedirectHarness = observer(function SessionRedirectHarness() {
  const { session } = useStores();
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const unsaved = useUnsavedChanges(value.length > 0);
  const hadAdmin = useRef(session.isAdmin);
  if (session.isAdmin) hadAdmin.current = true;

  useEffect(() => {
    if (!hadAdmin.current || !value) return;
    if (session.isAuthenticated && session.isAdmin) return;
    navigate(session.isAuthenticated ? '/revoked' : '/login', { replace: true });
  }, [navigate, session.isAdmin, session.isAuthenticated, value]);

  return (
    <>
      <label>
        草稿
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <Link to="/elsewhere">离开</Link>
      {unsaved.dialog}
    </>
  );
});

function StayMountedEditor() {
  const [value] = useState('草稿');
  const navigate = useNavigate();
  const unsaved = useUnsavedChanges(value.length > 0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          unsaved.allowLeave();
          navigate('/next');
        }}
      >
        保存并新建
      </button>
      <Link to="/elsewhere">离开</Link>
      <Outlet />
      {unsaved.dialog}
    </>
  );
}
