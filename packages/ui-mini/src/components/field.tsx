import { View, Text, Input } from '@tarojs/components';
import type { InputProps } from '@tarojs/components';

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
    <View style={{ display: 'block', marginBottom: '24rpx' }}>
      <Text
        style={{
          display: 'block',
          fontSize: '24rpx',
          color: '#6b7280',
          marginBottom: '8rpx',
          textTransform: 'uppercase',
          letterSpacing: '2rpx',
        }}
      >
        {label}
      </Text>
      <Input
        value={value}
        type={type}
        password={password}
        placeholder={placeholder}
        disabled={disabled}
        maxlength={maxlength ?? 140}
        onInput={(e) => onInput(e.detail.value)}
        style={{
          width: '100%',
          padding: '20rpx 24rpx',
          fontSize: '30rpx',
          background: '#ffffff',
          border: error ? '1rpx solid #ef4444' : '1rpx solid #e5e7eb',
          borderRadius: '12rpx',
          boxSizing: 'border-box',
        }}
      />
      {error ? (
        <Text style={{ display: 'block', color: '#dc2626', fontSize: '24rpx', marginTop: '8rpx' }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
