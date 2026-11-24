import { Text, View } from '@tarojs/components';
import type { Notice } from '../lib/notice';
import { isWebEnv } from '../lib/status-toast';

/** H5-only role=status bar. Weapp uses Taro.showToast instead (no stuck black bar). */
export function StatusToast({ notice }: { notice: Notice<{ text: string }> | null }) {
  if (!notice || !isWebEnv()) return null;
  return (
    <View key={notice.id} className="miniapp-status-toast" ariaRole="status">
      <Text className="miniapp-status-toast__text">{notice.text}</Text>
    </View>
  );
}
