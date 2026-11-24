import Taro from '@tarojs/taro';
import type { CSSProperties } from 'react';

const RPX = /(-?\d*\.?\d+)rpx/g;

/**
 * Inline `rpx` only works on mini-program runtimes; the H5 build drops the
 * declaration. `Taro.pxTransform` returns `rpx` on mini programs and `rem`
 * on H5, so the same inline style renders on both.
 */
export function rpxValue(value: string): string {
  return value.replace(RPX, (_, size: string) => Taro.pxTransform(Number(size)));
}

export function rpxStyle(style: CSSProperties): CSSProperties {
  const converted: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(style)) {
    converted[key] = typeof value === 'string' ? rpxValue(value) : value;
  }
  return converted;
}
