import {
  effectiveBotWidth,
  gridColumns,
  loadLayoutPrefs,
  saveLayoutPrefs,
  type BotWidth,
} from '../src/lib/layout';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('布局偏好', () => {
  it('缺省是 440、展开，坏数据也回到默认', () => {
    const storage = memoryStorage();
    expect(loadLayoutPrefs(storage)).toEqual({ botWidth: 440, botCollapsed: false });
    storage.setItem('agent-hub.layout.v1', '{');
    expect(loadLayoutPrefs(storage)).toEqual({ botWidth: 440, botCollapsed: false });
    saveLayoutPrefs(storage, { botWidth: 360, botCollapsed: true });
    expect(loadLayoutPrefs(storage)).toEqual({ botWidth: 360, botCollapsed: true });
  });

  it('窗口放不下时逐档调窄，不改传入的偏好', () => {
    const pref: BotWidth = 560;
    expect(effectiveBotWidth(pref, 1300)).toBe(560);
    expect(effectiveBotWidth(pref, 1200)).toBe(440);
    expect(effectiveBotWidth(pref, 1000)).toBe(360);
    expect(pref).toBe(560);
    expect(gridColumns(40)).toBe('40px 360px minmax(380px, 1fr)');
  });
});
