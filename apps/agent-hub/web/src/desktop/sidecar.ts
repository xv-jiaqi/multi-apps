// web/src/desktop/sidecar.ts
import type { UnlistenFn } from '@tauri-apps/api/event';
import { errorText, ipc, type LaunchInfo, type SidecarExited } from './ipc';
import { RestartPolicy } from './restart-policy';

export type SidecarState =
  | { kind: 'starting' }
  | { kind: 'ready'; info: LaunchInfo }
  /** 已退出，`delayMs` 后自动重启；`exit.lastStderr` 是侧车 stderr 的最后 50 行或上次重启的报错。 */
  | { kind: 'restarting'; delayMs: number; exit: SidecarExited }
  /** 不再自动重启，等人点“重试”。 */
  | { kind: 'failed'; message: string };

export interface SidecarDeps {
  start(): Promise<LaunchInfo>;
  restart(): Promise<LaunchInfo>;
  onExited(handler: (exit: SidecarExited) => void): Promise<UnlistenFn>;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

/** Rust 在另一次启动还没结束时返回的错误（页面在侧车启动期间被重新加载）。 */
const STARTING = 'SIDECAR_STARTING';
const STARTING_RETRY_MS = 500;
/** 50 × 0.5 秒 > Rust 的 READY_TIMEOUT（20 秒）。 */
const STARTING_RETRY_LIMIT = 50;

export class SidecarController {
  private state: SidecarState = { kind: 'starting' };
  private readonly listeners = new Set<() => void>();
  private readonly policy: RestartPolicy;
  private timer: unknown = null;
  private started = false;
  private launching = false;
  private exitWhileLaunching: SidecarExited | null = null;

  constructor(private readonly deps: SidecarDeps) {
    this.policy = new RestartPolicy(() => deps.now());
  }

  readonly getState = (): SidecarState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 应用启动时调用；重复调用无效。 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.deps.onExited((exit) => this.handleExit(exit));
    await this.launch('start', false);
  }

  /** 错误页的“重试”、设置页的“重启服务”：清零失败计数，立即重启。启动进行中时忽略。 */
  async restartNow(): Promise<void> {
    if (this.launching) return;
    if (this.timer !== null) {
      this.deps.clearTimeout(this.timer);
      this.timer = null;
    }
    this.policy.reset();
    await this.launch('restart', false);
  }

  private handleExit(exit: SidecarExited): void {
    if (this.launching) {
      // 事件可能比 sidecar_start 的返回值先到；等启动调用结束后再处理。
      this.exitWhileLaunching = exit;
      return;
    }
    if (this.state.kind === 'ready') this.scheduleRestart(exit);
  }

  private scheduleRestart(exit: SidecarExited): void {
    const delayMs = this.policy.nextDelay();
    if (delayMs === null) {
      const tail = exit.lastStderr ? `\n${exit.lastStderr}` : '';
      this.set({ kind: 'failed', message: `侧车 5 分钟内反复退出，已停止自动重启。${tail}` });
      return;
    }
    this.set({ kind: 'restarting', delayMs, exit });
    this.timer = this.deps.setTimeout(() => {
      this.timer = null;
      void this.launch('restart', true);
    }, delayMs);
  }

  /** `automatic`：这是一次自动重启，失败时继续按退避重试，而不是直接显示错误页。 */
  private async launch(how: 'start' | 'restart', automatic: boolean): Promise<void> {
    this.launching = true;
    this.exitWhileLaunching = null;
    this.set({ kind: 'starting' });
    let info: LaunchInfo | null = null;
    let failure = '';
    try {
      info = await this.call(how);
    } catch (error) {
      failure = errorText(error);
    }
    this.launching = false;
    if (info) {
      this.set({ kind: 'ready', info });
      const exit = this.exitWhileLaunching;
      this.exitWhileLaunching = null;
      if (exit) this.scheduleRestart(exit);
    } else if (automatic) {
      this.scheduleRestart({ code: null, lastStderr: failure });
    } else {
      this.set({ kind: 'failed', message: failure });
    }
  }

  private async call(how: 'start' | 'restart'): Promise<LaunchInfo> {
    if (how === 'restart') return this.deps.restart();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.deps.start();
      } catch (error) {
        if (errorText(error) !== STARTING || attempt >= STARTING_RETRY_LIMIT) throw error;
        await new Promise<void>((resolve) => this.deps.setTimeout(resolve, STARTING_RETRY_MS));
      }
    }
  }

  private set(state: SidecarState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export const DEFAULT_PORT = 47821;
const DEV_TOKEN_KEY = 'agent-hub.devUiToken';
const DEV_TOKEN_HASH = /^#uiToken=(ahu_[A-Za-z0-9_-]{43})$/;

/**
 * 浏览器开发模式：把侧车 stderr 打印的 `http://localhost:5174/#uiToken=…` 里的 token 存进
 * sessionStorage，并把地址改成 `#/`。必须在创建 hash 路由之前调用。
 */
export function takeDevToken(location: Location, history: History, storage: Storage): void {
  const match = DEV_TOKEN_HASH.exec(location.hash);
  if (!match?.[1]) return;
  storage.setItem(DEV_TOKEN_KEY, match[1]);
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
}

/** 浏览器开发模式下的“启动”：只能连默认端口上已经在运行的侧车。 */
export function browserLaunchInfo(storage: Storage): LaunchInfo {
  const uiToken = storage.getItem(DEV_TOKEN_KEY);
  if (!uiToken) {
    throw new Error(
      '浏览器开发模式：先运行 pnpm --filter @agent-hub/server dev，再打开它在终端里打印的 Hub UI 链接（带 #uiToken=）。',
    );
  }
  const host = `127.0.0.1:${DEFAULT_PORT}`;
  return {
    baseUrl: `http://${host}`,
    wsUrl: `ws://${host}/api/v1/ws`,
    uiToken,
    serverVersion: '',
  };
}

function createSidecar(): SidecarController {
  const timers = {
    setTimeout: (callback: () => void, ms: number): unknown => window.setTimeout(callback, ms),
    clearTimeout: (handle: unknown): void => window.clearTimeout(handle as number),
    now: (): number => Date.now(),
  };
  if (ipc.inTauri()) {
    return new SidecarController({
      start: ipc.sidecarStart,
      restart: ipc.sidecarRestart,
      onExited: ipc.onSidecarExited,
      ...timers,
    });
  }
  const fromStorage = async (): Promise<LaunchInfo> => browserLaunchInfo(window.sessionStorage);
  return new SidecarController({
    start: fromStorage,
    restart: fromStorage,
    onExited: async () => () => {},
    ...timers,
  });
}

/** 全局唯一。React 里用 `useSidecarState()`（hooks.ts）。 */
export const sidecar = createSidecar();
