// web/src/desktop/bot-panel.ts
import type { HubConfig } from '@agent-hub/contract';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWebview, Webview } from '@tauri-apps/api/webview';
import { errorText, ipc } from './ipc';

export type BotConfig = HubConfig['bot'];

export type BotPanelState =
  /** 浏览器开发模式：没有原生子 WebView。 */
  | { kind: 'unsupported' }
  /** `bot.url` 为空（D29）。 */
  | { kind: 'unconfigured' }
  /** `bot.openExternally`：不内嵌，只给“用浏览器打开”（R4 的退路）。 */
  | { kind: 'external'; url: string }
  | { kind: 'opening' }
  | { kind: 'open' }
  | { kind: 'error'; message: string };

/** `BotSlot` 元素在 Hub UI 视口里的位置（CSS 像素 = 逻辑像素）。 */
export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Applied {
  rect: SlotRect | null;
  visible: boolean;
}

/** Hub UI 里原生 Bot 子 WebView 的唯一控制点：只有这里调用 `bot_open` 和 `Webview` 的方法。 */
export class BotPanel {
  private state: BotPanelState;
  private config: BotConfig | null = null;
  private slot: SlotRect | null = null;
  private occluders = 0;
  /** 每次 `bot_open` 加一；旧一代的布局结果作废。 */
  private epoch = 0;
  private applied: Applied | null = null;
  private handle: Webview | null = null;
  private running = false;
  private dirty = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly native = ipc.inTauri()) {
    this.state = native ? { kind: 'unconfigured' } : { kind: 'unsupported' };
  }

  readonly getState = (): BotPanelState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 启动后和每次保存设置后调用。配置没变且没有出错时什么都不做；出错后再调用即重试。 */
  async configure(config: BotConfig): Promise<void> {
    if (!this.native) return;
    if (this.config && sameConfig(this.config, config) && this.state.kind !== 'error') return;
    this.config = config;
    if (!config.url) {
      this.set({ kind: 'unconfigured' });
      this.schedule();
      return;
    }
    if (config.openExternally) {
      this.set({ kind: 'external', url: config.url });
      this.schedule();
      return;
    }
    this.epoch += 1;
    this.applied = null;
    this.set({ kind: 'opening' });
    try {
      await ipc.botOpen({
        url: config.url,
        allowedOrigins: [...new Set([...config.allowedOrigins, ...config.authOrigins])],
        userAgent: config.userAgent,
      });
      this.set({ kind: 'open' });
    } catch (error) {
      this.set({ kind: 'error', message: errorText(error) });
    }
    this.schedule();
  }

  /** `BotSlot` 的位置；`null` = 左栏收起或 `BotSlot` 卸载。 */
  setSlot(rect: SlotRect | null): void {
    const next = rect && rounded(rect);
    if (sameRect(this.slot, next)) return;
    this.slot = next;
    this.schedule();
  }

  /** 浮层打开时调用，返回的函数在浮层关闭时调用（§5.3）。可以嵌套。 */
  occlude(): () => void {
    this.occluders += 1;
    this.schedule();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.occluders -= 1;
      this.schedule();
    };
  }

  async reload(): Promise<void> {
    if (this.state.kind === 'open') await ipc.botReload();
  }

  /** 设置页“清除本地郎登录数据”：清 Bot 独立数据存储里的 Cookie 与缓存，然后重新加载。 */
  async clearBrowsingData(): Promise<void> {
    if (this.state.kind !== 'open') return;
    const bot = await this.webview();
    await bot?.clearAllBrowsingData();
    await ipc.botReload();
  }

  private visible(): boolean {
    const { slot } = this;
    return (
      this.state.kind === 'open' &&
      slot !== null &&
      slot.width >= 1 &&
      slot.height >= 1 &&
      this.occluders === 0
    );
  }

  /** 原生调用一次只跑一组；期间的变化合并成下一组。 */
  private schedule(): void {
    this.dirty = true;
    if (this.running || !this.native) return;
    this.running = true;
    void (async () => {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.applyOnce();
        } catch (error) {
          this.applied = null;
          console.warn('[bot-panel]', errorText(error));
        }
      }
      this.running = false;
    })();
  }

  private async applyOnce(): Promise<void> {
    if (this.state.kind === 'opening') return;
    const epoch = this.epoch;
    const visible = this.visible();
    const rect = visible ? this.slot : null;
    const prev = this.applied;
    if (prev && prev.visible === visible && (!rect || sameRect(prev.rect, rect))) return;
    const bot = await this.webview();
    if (!bot) {
      // 还没有 Bot 子 WebView（没配置地址或 bot_open 失败）：没什么可隐藏的。
      if (!visible && epoch === this.epoch) this.applied = { rect: null, visible: false };
      return;
    }
    if (rect && !sameRect(prev?.rect ?? null, rect)) {
      await bot.setPosition(new LogicalPosition(rect.x, rect.y));
      await bot.setSize(new LogicalSize(rect.width, rect.height));
    }
    if (prev?.visible !== visible) {
      if (visible) {
        await bot.show();
      } else {
        await bot.hide();
        // 焦点可能还留在刚隐藏的 Bot 页面里，键盘输入会丢。
        await getCurrentWebview().setFocus();
      }
    }
    if (epoch === this.epoch) this.applied = { rect: rect ?? prev?.rect ?? null, visible };
  }

  /** `Webview` 对象按 label 寻址，`bot_open` 重建后旧对象照样指向新的 Bot 子 WebView。 */
  private async webview(): Promise<Webview | null> {
    this.handle ??= await Webview.getByLabel('bot');
    return this.handle;
  }

  private set(state: BotPanelState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function rounded(rect: SlotRect): SlotRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function sameRect(a: SlotRect | null, b: SlotRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameConfig(a: BotConfig, b: BotConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 全局唯一。React 里用 `useBotPanelState()` / `useBotSlot()` / `useBotOcclusion()`（hooks.ts）。 */
export const botPanel = new BotPanel();
