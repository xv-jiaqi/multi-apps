import { View, Text, Input } from '@tarojs/components';
import type { InputProps } from '@tarojs/components';
import { rpxStyle } from '../rpx';

export interface FieldProps {
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  /**
   * Taro's `Input` supports a subset of HTML input types; we expose the
   * most common ones the miniapp auth flows need.
   */
  type?: InputProps['type'];
  /** When true the input masks characters (e.g. password). */
  password?: boolean;
  disabled?: boolean;
  maxlength?: number;
  error?: string | null;
}

/**
 * Labeled text input tuned for Taro miniapp forms. Purely composes built-in
 * `<Input>` so there's no runtime cost or extra font assets.
 */
export function Field({
  label,
  value,
  onInput,
  placeholder,
  type = 'text',
  password,
  disabled,
  maxlength,
  error,
}: FieldProps) {
  return (
    <View style={rpxStyle({ display: 'block', marginBottom: '24rpx' })}>
      <Text
        style={rpxStyle({
          display: 'block',
          fontSize: '24rpx',
          color: '#525252',
          marginBottom: '8rpx',
          textTransform: 'uppercase',
          letterSpacing: '2rpx',
        })}
      >
        {label}
      </Text>
      <Input
        value={value}
        type={type}
        password={password ? true : undefined}
        placeholder={placeholder}
        disabled={disabled ? true : undefined}
        maxlength={maxlength ?? 140}
        onInput={(e) => onInput(e.detail.value)}
        style={rpxStyle({
          width: '100%',
          padding: '20rpx 24rpx',
          fontSize: '30rpx',
          background: '#ffffff',
          border: error ? '1rpx solid #ef4444' : '1rpx solid #e5e7eb',
          borderRadius: '12rpx',
          boxSizing: 'border-box',
        })}
      />
      {error ? (
        <Text
          style={rpxStyle({
            display: 'block',
            color: '#dc2626',
            fontSize: '24rpx',
            marginTop: '8rpx',
          })}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
