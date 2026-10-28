// web/src/desktop/attention.ts
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { ipc } from './ipc';
import type { NotificationText } from './notify-rules';

let tray: Promise<TrayIcon | null> | null = null;
let trayTitle: string | null | undefined;

/** 菜单栏图标旁的标题 = 待审批数，0 时不显示（D28）。 */
export async function setTrayCount(pendingApprovals: number): Promise<void> {
  if (!ipc.inTauri()) return;
  const title = pendingApprovals > 0 ? String(pendingApprovals) : null;
  if (title === trayTitle) return;
  trayTitle = title;
  tray ??= TrayIcon.getById('main');
  await (await tray)?.setTitle(title);
}

let permission: Promise<boolean> | null = null;

/** 主窗口不在前台时发系统通知（D28）。第一次发之前向 macOS 申请通知权限，被拒后不再申请。 */
export async function notifyInBackground(text: NotificationText): Promise<void> {
  if (!ipc.inTauri()) return;
  if (await getCurrentWindow().isFocused()) return;
  permission ??= (async () =>
    (await isPermissionGranted()) || (await requestPermission()) === 'granted')();
  if (await permission) sendNotification({ title: text.title, body: text.body });
}

/** 关窗只是隐藏（D11）；要弹确认框之前先把主窗口拉回前台。 */
export async function showMainWindow(): Promise<void> {
  if (!ipc.inTauri()) return;
  const main = getCurrentWindow();
  await main.unminimize();
  await main.show();
  await main.setFocus();
}
