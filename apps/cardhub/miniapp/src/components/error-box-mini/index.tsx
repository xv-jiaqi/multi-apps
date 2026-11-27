import { Text, View } from '@tarojs/components';
import { FocusableButton } from '@repo/ui-mini';
import './index.scss';

export interface ErrorBoxMiniProps {
  /** Fixed i18n title, e.g. `home.series.loadFailed`. Never server text. */
  title: string;
  retryLabel: string;
  retryingLabel: string;
  retrying: boolean;
  onRetry: () => void;
}

/**
 * CH-301 §6 block-level failure: red-50 box, red-200 edge, red-700 text,
 * and a retry button of at least 88rpx. Render with `key={noticeId}` so a
 * repeated failure is announced again.
 */
export function ErrorBoxMini({
  title,
  retryLabel,
  retryingLabel,
  retrying,
  onRetry,
}: ErrorBoxMiniProps) {
  return (
    <View className="error-box-mini" ariaRole="alert">
      <Text className="error-box-mini__title">{title}</Text>
      <FocusableButton
        className="error-box-mini__retry"
        disabled={retrying ? true : undefined}
        aria-disabled={retrying ? true : undefined}
        ariaLabel={retrying ? retryingLabel : retryLabel}
        onClick={retrying ? undefined : () => onRetry()}
      >
        {retrying ? retryingLabel : retryLabel}
      </FocusableButton>
    </View>
  );
}
