import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Button } from '@repo/ui-web';
import { api } from '../api/api';
import { pendingApprovalsQuery, settingsQuery } from '../api/queries';
import { errorMessage } from '../api/client';
import { ipc } from '../desktop/ipc';
import { installAppMenu, type MenuActions } from '../desktop/menu';
import { showMainWindow } from '../desktop/attention';
import { botPanel } from '../desktop/bot-panel';
import { sidecar } from '../desktop/sidecar';
import { useSidecarState } from '../desktop/hooks';
import { focusRing } from '../lib/format';
import {
  effectiveBotWidth,
  gridColumns,
  loadLayoutPrefs,
  saveLayoutPrefs,
  type LayoutPrefs,
} from '../lib/layout';
import { toast } from '../lib/toast';
import { paths } from './paths';
import { useDesktopSync, useWindowWidth } from './hooks';
import { createQuitHandler } from './quit';
import { BotColumn } from '../components/bot-column';
import { HubAlertDialog } from '../components/hub-dialog';
import { Toaster } from '../components/toaster';
import { TopBar } from '../components/top-bar';

let menuInstalled = false;

export function AppShell(): ReactElement {
  const sidecarState = useSidecarState();
  const everReady = useEverReady(sidecarState.kind === 'ready');
  const [prefs, setPrefs] = useState<LayoutPrefs>(() => loadLayoutPrefs(window.localStorage));
  const width = useWindowWidth();
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useQuery({ ...settingsQuery(), enabled: sidecarState.kind === 'ready' });
  const pending = useQuery({ ...pendingApprovalsQuery(), enabled: sidecarState.kind === 'ready' });
  useDesktopSync({
    settings: settings.data?.config,
    pendingCount: pending.data?.items.length ?? 0,
  });

  const actions = useRef<MenuActions>({
    openSettings: () => undefined,
    newTask: () => undefined,
    toggleBot: () => undefined,
    reloadBot: () => undefined,
    requestQuit: () => undefined,
  });
  const [quitMessage, setQuitMessage] = useState<string | null>(null);
  const confirmRef = useRef<(value: boolean) => void>(() => undefined);
  const quit = useMemo(
    () =>
      createQuitHandler({
        countActive: async (signal) => {
          const page = await api.listTasks(
            { archived: false, status: 'queued,preparing,running', limit: 200 },
            signal,
          );
          return page.items.length;
        },
        confirm: (message) =>
          new Promise((resolve) => {
            let settled = false;
            const finish = (value: boolean): void => {
              if (settled) return;
              settled = true;
              setQuitMessage(null);
              resolve(value);
            };
            confirmRef.current = finish;
            setQuitMessage(message);
          }),
        showMainWindow,
        quitApp: () => ipc.quitApp(),
      }),
    [],
  );

  actions.current = {
    openSettings: () => navigate(paths.settings()),
    newTask: () => navigate(paths.newTask()),
    toggleBot: () =>
      setPrefs((current) => {
        const next = { ...current, botCollapsed: !current.botCollapsed };
        saveLayoutPrefs(window.localStorage, next);
        return next;
      }),
    reloadBot: () => {
      void botPanel.reload();
    },
    requestQuit: quit,
  };

  useEffect(() => {
    if (menuInstalled) return;
    menuInstalled = true;
    void installAppMenu({
      openSettings: () => actions.current.openSettings(),
      newTask: () => actions.current.newTask(),
      toggleBot: () => actions.current.toggleBot(),
      reloadBot: () => actions.current.reloadBot(),
      requestQuit: () => actions.current.requestQuit(),
    });
  }, []);

  function updatePrefs(next: LayoutPrefs): void {
    setPrefs(next);
    saveLayoutPrefs(window.localStorage, next);
  }

  const showBoot = sidecarState.kind === 'failed' || (!everReady && sidecarState.kind !== 'ready');
  const settingsRoute = location.pathname.startsWith('/settings');
  const left = prefs.botCollapsed ? 40 : effectiveBotWidth(prefs.botWidth, width);

  return (
    <>
      {showBoot ? (
        <BootScreen
          mode={sidecarState.kind === 'failed' ? 'failed' : 'starting'}
          message={sidecarState.kind === 'failed' ? sidecarState.message : ''}
        />
      ) : (
        <main
          className="grid h-full min-h-0 bg-white"
          style={{
            gridTemplateColumns: gridColumns(left),
            gridTemplateRows: '44px minmax(0, 1fr)',
          }}
        >
          <TopBar />
          <BotColumn prefs={prefs} onChange={updatePrefs} />
          {settingsRoute ? (
            <div className="col-span-2 row-start-2 min-h-0 min-w-0 overflow-hidden">
              <Outlet />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      )}
      <Toaster />
      <HubAlertDialog
        open={quitMessage !== null}
        onOpenChange={(open) => {
          if (!open) confirmRef.current(false);
        }}
        title="退出 Agent Hub"
        description={quitMessage ?? ''}
        confirmText="退出"
        onConfirm={() => confirmRef.current(true)}
      />
    </>
  );
}

function useEverReady(ready: boolean): boolean {
  const ever = useRef(ready);
  if (ready) ever.current = true;
  return ever.current;
}

function BootScreen(props: { mode: 'starting' | 'failed'; message: string }): ReactElement {
  if (props.mode === 'starting') {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <p className="text-base text-neutral-800">正在启动本地服务…</p>
      </main>
    );
  }
  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-3 rounded-lg border border-red-300 bg-red-50 p-4">
        <h1 className="text-lg font-semibold text-neutral-900">本地服务没有启动</h1>
        <pre className="select-text whitespace-pre-wrap font-mono text-sm text-red-800">
          {props.message}
        </pre>
        <div className="flex gap-2">
          <Button type="button" onClick={() => void sidecar.restartNow()}>
            重试
          </Button>
          <button
            type="button"
            className={`inline-flex h-10 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm ${focusRing}`}
            onClick={() => {
              void navigator.clipboard.writeText(props.message).catch((error: unknown) => {
                toast.error(errorMessage(error));
              });
            }}
          >
            复制错误信息
          </button>
        </div>
      </div>
    </main>
  );
}
