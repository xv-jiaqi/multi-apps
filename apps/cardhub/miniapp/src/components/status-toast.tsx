import { Text, View } from '@tarojs/components';
import type { Notice } from '../lib/notice';
import { isWebEnv, useStatusToastPlacement } from '../lib/status-toast';

/** H5-only role=status bar. Weapp uses Taro.showToast instead (no stuck black bar). */
export function StatusToast({
  notice,
  avoidSelector,
}: {
  notice: Notice<{ text: string }> | null;
  avoidSelector?: string;
}) {
  const placement = useStatusToastPlacement(notice, avoidSelector);
  if (!notice || !isWebEnv()) return null;
  return (
    <View
      key={notice.id}
      className={`miniapp-status-toast${placement === 'bottom' ? ' miniapp-status-toast--bottom' : ''}`}
      ariaRole="status"
    >
      <Text className="miniapp-status-toast__text">{notice.text}</Text>
    </View>
  );
}
