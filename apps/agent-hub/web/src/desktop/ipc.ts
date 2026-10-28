// web/src/desktop/ipc.ts
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** 与 lib.rs 的 `LaunchInfo` 一致（serde camelCase）。 */
export interface LaunchInfo {
  baseUrl: string;
  wsUrl: string;
  uiToken: string;
  serverVersion: string;
}

/** `sidecar://exited` 的载荷。只有**就绪过**的侧车意外退出时才发。 */
export interface SidecarExited {
  code: number | null;
  lastStderr: string;
}

export type BotOpenArgs = {
  url: string;
  /** 导航与登录弹窗都放行的 origin；Rust 会自动加上 `url` 自己的 origin。 */
  allowedOrigins: string[];
  userAgent: string | null;
};

/** 失败时 reject 的值是 Rust 返回的中文字符串，用 `errorText()` 取。 */
export const ipc = {
  inTauri: (): boolean => isTauri(),
  sidecarStart: (): Promise<LaunchInfo> => invoke<LaunchInfo>('sidecar_start'),
  sidecarRestart: (): Promise<LaunchInfo> => invoke<LaunchInfo>('sidecar_restart'),
  botOpen: (args: BotOpenArgs): Promise<void> => invoke<void>('bot_open', args),
  botReload: (): Promise<void> => invoke<void>('bot_reload'),
  quitApp: (): Promise<void> => invoke<void>('quit_app'),
  onSidecarExited: (handler: (payload: SidecarExited) => void): Promise<UnlistenFn> =>
    listen<SidecarExited>('sidecar://exited', (event) => handler(event.payload)),
};

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
