import Taro from '@tarojs/taro';

/** Lists that refresh to page 1 after the author just submitted. CH-301 §2.8 v1.5. */
export type ListRefreshTarget = 'forum' | 'trade';

const pending = new Set<ListRefreshTarget>();

export function markListNeedsRefresh(target: ListRefreshTarget): void {
  pending.add(target);
}

export function consumeListNeedsRefresh(target: ListRefreshTarget): boolean {
  if (!pending.has(target)) return false;
  pending.delete(target);
  return true;
}

/** For tests. */
export function resetListRefreshFlags(): void {
  pending.clear();
}

/**
 * Leave a compose page: pop back to the previous page when there is one
 * (the list), otherwise switchTab onto the list tab.
 */
export function leaveToTabPage(url: string): void {
  if (Taro.getCurrentPages().length > 1) {
    void Taro.navigateBack({ delta: 1 });
    return;
  }
  void Taro.switchTab({ url });
}
