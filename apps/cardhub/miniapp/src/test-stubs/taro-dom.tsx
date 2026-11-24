/**
 * DOM stand-ins for `@tarojs/components`, for page-level tests under jsdom.
 * Button renders a native <button>, so Enter / Space activate it the way a
 * browser (and Taro H5) does. Input / Textarea report `e.detail.value`.
 */
import { createElement, type ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function domProps(props: AnyProps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const native = (props.nativeProps as Record<string, unknown> | undefined) ?? {};
  const merged = { ...native, ...props };
  for (const [key, value] of Object.entries(merged)) {
    if (key === 'nativeProps') continue;
    if (
      key === 'className' ||
      key === 'style' ||
      key === 'onClick' ||
      key === 'onKeyDown' ||
      key === 'disabled' ||
      key === 'id' ||
      key === 'tabIndex' ||
      key === 'role'
    ) {
      out[key] = value;
    } else if (
      key === 'aria-disabled' ||
      key === 'aria-pressed' ||
      key === 'aria-describedby' ||
      key === 'aria-labelledby' ||
      key === 'aria-label' ||
      key === 'ariaRole'
    ) {
      out[key === 'ariaRole' ? 'role' : key] = value;
    } else if (key === 'ariaPressed') {
      out['aria-pressed'] = value;
    } else if (key === 'ariaLabel') {
      out['aria-label'] = value;
    } else if (key === 'maxlength') {
      out.maxLength = value;
    }
  }
  return out;
}

export function View(props: AnyProps) {
  return createElement('div', domProps(props), props.children);
}
export function Text(props: AnyProps) {
  return createElement('span', domProps(props), props.children);
}
export function ScrollView(props: AnyProps) {
  return createElement('div', domProps(props), props.children);
}
export function Image(props: AnyProps) {
  return createElement('img', { ...domProps(props), src: props.src, alt: '' });
}
export function Button(props: AnyProps) {
  return createElement('button', { type: 'button', ...domProps(props) }, props.children);
}
function field(tag: 'input' | 'textarea') {
  return function Field(props: AnyProps) {
    const onInput = props.onInput as ((e: { detail: { value: string } }) => void) | undefined;
    return createElement(tag, {
      ...domProps(props),
      value: props.value ?? '',
      placeholder: props.placeholder,
      type: tag === 'input' ? (props.password ? 'password' : 'text') : undefined,
      onChange: (e: { target: { value: string } }) =>
        onInput?.({ detail: { value: e.target.value } }),
    });
  };
}
export const Input = field('input');
export const Textarea = field('textarea');
export type ButtonProps = Record<string, unknown>;
export type InputProps = Record<string, unknown>;

export function Picker(props: AnyProps) {
  return createElement('div', domProps(props), props.children);
}
