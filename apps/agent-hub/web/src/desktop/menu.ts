// web/src/desktop/menu.ts
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { ipc } from './ipc';

export interface MenuActions {
  openSettings(): void;
  newTask(): void;
  toggleBot(): void;
  reloadBot(): void;
  /** ⌘Q：有进行中的任务时先确认（hub-ui.md §5.7），再调 `ipc.quitApp()`。 */
  requestQuit(): void;
}

/**
 * 应用菜单（§5.4）。快捷键必须挂在原生菜单上：焦点在 Bot 页面里时 Hub UI 收不到键盘事件，
 * 原生菜单的快捷键照样触发，回调在 Hub UI 里执行。Hub UI 每次加载都重新安装一次。
 */
export async function installAppMenu(actions: MenuActions): Promise<void> {
  if (!ipc.inTauri()) return;
  const separator = (): Promise<PredefinedMenuItem> =>
    PredefinedMenuItem.new({ item: 'Separator' });
  const app = await Submenu.new({
    text: 'Agent Hub',
    items: [
      await PredefinedMenuItem.new({ item: { About: null }, text: '关于 Agent Hub' }),
      await separator(),
      await MenuItem.new({
        text: '设置…',
        accelerator: 'CmdOrCtrl+,',
        action: () => actions.openSettings(),
      }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Hide', text: '隐藏 Agent Hub' }),
      await PredefinedMenuItem.new({ item: 'HideOthers', text: '隐藏其他' }),
      await PredefinedMenuItem.new({ item: 'ShowAll', text: '全部显示' }),
      await separator(),
      await MenuItem.new({
        text: '退出 Agent Hub',
        accelerator: 'CmdOrCtrl+Q',
        action: () => actions.requestQuit(),
      }),
    ],
  });
  // 没有“编辑”菜单时，两个 WebView 里的 ⌘C / ⌘V / ⌘A 都不生效。
  const edit = await Submenu.new({
    text: '编辑',
    items: [
      await PredefinedMenuItem.new({ item: 'Undo', text: '撤销' }),
      await PredefinedMenuItem.new({ item: 'Redo', text: '重做' }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Cut', text: '剪切' }),
      await PredefinedMenuItem.new({ item: 'Copy', text: '复制' }),
      await PredefinedMenuItem.new({ item: 'Paste', text: '粘贴' }),
      await PredefinedMenuItem.new({ item: 'SelectAll', text: '全选' }),
    ],
  });
  const task = await Submenu.new({
    text: '任务',
    items: [
      await MenuItem.new({
        text: '新建任务…',
        accelerator: 'CmdOrCtrl+N',
        action: () => actions.newTask(),
      }),
    ],
  });
  const view = await Submenu.new({
    text: '显示',
    items: [
      await MenuItem.new({
        text: '收起 / 展开本地郎',
        accelerator: 'CmdOrCtrl+1',
        action: () => actions.toggleBot(),
      }),
      await MenuItem.new({
        text: '刷新本地郎',
        accelerator: 'CmdOrCtrl+Shift+R',
        action: () => actions.reloadBot(),
      }),
    ],
  });
  const windowMenu = await Submenu.new({
    text: '窗口',
    items: [
      await PredefinedMenuItem.new({ item: 'Minimize', text: '最小化' }),
      // 走 CloseRequested，被 Rust 改成隐藏窗口（D11）。
      await PredefinedMenuItem.new({ item: 'CloseWindow', text: '关闭窗口' }),
    ],
  });
  const menu = await Menu.new({ items: [app, edit, task, view, windowMenu] });
  await menu.setAsAppMenu();
}
