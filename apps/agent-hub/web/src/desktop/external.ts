// web/src/desktop/external.ts
import { openUrl as openInOpener, revealItemInDir } from '@tauri-apps/plugin-opener';
import { ipc } from './ipc';

/** 用系统默认浏览器打开链接；只接受 http / https（capability 的 opener 范围也只放行这两种）。 */
export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只能打开 http / https 链接');
  }
  if (ipc.inTauri()) {
    await openInOpener(parsed.href);
  } else {
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  }
}

/** 在 Finder 里选中这个路径（worktree 目录、仓库目录、数据目录）。 */
export async function revealInFinder(path: string): Promise<void> {
  if (!ipc.inTauri()) throw new Error('浏览器开发模式不支持在 Finder 中显示');
  await revealItemInDir(path);
}
