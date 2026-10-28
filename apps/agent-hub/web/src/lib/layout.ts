import { z } from 'zod';

export type BotWidth = 360 | 440 | 560;
export type LayoutPrefs = { botWidth: BotWidth; botCollapsed: boolean };

const STORAGE_KEY = 'agent-hub.layout.v1';
const BOT_WIDTHS: readonly BotWidth[] = [360, 440, 560];
const MIDDLE_WIDTH = 360;
const RIGHT_MIN_WIDTH = 380;
const DEFAULT_PREFS: LayoutPrefs = { botWidth: 440, botCollapsed: false };

const prefsSchema = z.object({
  botWidth: z.union([z.literal(360), z.literal(440), z.literal(560)]),
  botCollapsed: z.boolean(),
});

export function loadLayoutPrefs(storage: Storage): LayoutPrefs {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_PREFS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  const result = prefsSchema.safeParse(parsed);
  if (!result.success) return { ...DEFAULT_PREFS };
  return result.data;
}

export function saveLayoutPrefs(storage: Storage, prefs: LayoutPrefs): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/** 从偏好档开始，窗口放不下就降一档，直到 360。偏好本身不改。 */
export function effectiveBotWidth(pref: BotWidth, windowWidth: number): BotWidth {
  const start = BOT_WIDTHS.indexOf(pref);
  const from = start < 0 ? 1 : start;
  for (let index = from; index >= 0; index -= 1) {
    const width = BOT_WIDTHS[index];
    if (width === undefined) continue;
    if (windowWidth >= width + MIDDLE_WIDTH + RIGHT_MIN_WIDTH) return width;
  }
  return 360;
}

export function gridColumns(leftWidth: number): string {
  return `${leftWidth}px 360px minmax(380px, 1fr)`;
}

export function nextBotWidth(current: BotWidth): BotWidth {
  const index = BOT_WIDTHS.indexOf(current);
  return BOT_WIDTHS[index + 1] ?? BOT_WIDTHS[0] ?? 440;
}
