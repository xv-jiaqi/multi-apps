import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { controlBase, controlSm, optionBase, popoverSurface } from './form-styles';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> {
  size?: 'default' | 'sm';
}

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ className, children, size = 'default', ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      controlBase,
      'justify-between gap-2 data-[placeholder]:text-neutral-500',
      size === 'sm' && controlSm,
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 shrink-0 text-neutral-500" aria-hidden="true" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>;

// Radix Select's hideOthers() sets aria-hidden on the portal's siblings (#root) but
// leaves their links and buttons focusable (axe aria-hidden-focus). Make those
// siblings inert while the list is open so they leave the tab order too.
// Radix moves focus back to the trigger (inside #root) in onCloseAutoFocus, which runs
// before this effect cleans up, so the returned restore() must run there first.
function useInertOutside(node: HTMLElement | null) {
  const restoreRef = React.useRef<(() => void) | null>(null);
  React.useLayoutEffect(() => {
    if (!node) return;
    let top: HTMLElement = node;
    while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    const changed: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === top || !(el instanceof HTMLElement) || el.hasAttribute('inert')) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      el.setAttribute('inert', '');
      changed.push(el);
    }
    const restore = () => {
      for (const el of changed.splice(0)) el.removeAttribute('inert');
    };
    restoreRef.current = restore;
    return () => {
      restore();
      if (restoreRef.current === restore) restoreRef.current = null;
    };
  }, [node]);
  return React.useCallback(() => restoreRef.current?.(), []);
}

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(
  (
    { className, children, position = 'popper', sideOffset = 4, onCloseAutoFocus, ...props },
    ref,
  ) => {
    const [node, setNode] = React.useState<HTMLDivElement | null>(null);
    const restoreOutside = useInertOutside(node);
    const setRefs = React.useCallback(
      (el: HTMLDivElement | null) => {
        setNode(el);
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={setRefs}
          position={position}
          sideOffset={sideOffset}
          onCloseAutoFocus={(event) => {
            restoreOutside();
            onCloseAutoFocus?.(event);
          }}
          className={cn(
            popoverSurface,
            'max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-y-auto',
            className,
          )}
          {...props}
        >
          <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-xs font-medium text-neutral-500', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item ref={ref} className={cn(optionBase, className)} {...props}>
    <span className="absolute left-2 inline-flex size-4 items-center justify-center text-brand-600">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-neutral-200', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;
