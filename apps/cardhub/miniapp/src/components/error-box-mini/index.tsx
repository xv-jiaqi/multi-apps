import { Button, Text, View } from '@tarojs/components';
import type { ButtonProps } from '@tarojs/components';
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
      <Button
        className="error-box-mini__retry"
        // Taro H5 writes `disabled="false"`, which still matches `[disabled]`,
        // and still fires onClick on a disabled button.
        disabled={retrying ? true : undefined}
        ariaLabel={retrying ? retryingLabel : retryLabel}
        {...(retrying
          ? ({
              ariaDisabled: true,
              'aria-disabled': true,
            } as ButtonProps)
          : { onClick: () => onRetry() })}
      >
        {retrying ? retryingLabel : retryLabel}
      </Button>
    </View>
  );
}
