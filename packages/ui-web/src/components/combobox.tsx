import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, Loader2, Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { controlBase, controlSm, optionBase, popoverSurface } from './form-styles';

type ComboboxStatus = 'idle' | 'loading' | 'error' | 'success';

export interface ComboboxGroup<T> {
  key: string;
  label?: string;
  items: T[];
}

export interface ComboboxLabels {
  empty: string;
  loading: string;
  error: string;
  retry: string;
  clear: string;
  resultsCount: (count: number) => string;
}

export interface ComboboxProps<T> {
  mode: 'select' | 'navigate';
  value?: T | null;
  onValueChange?: (item: T | null) => void;
  onSelect?: (item: T) => void;
  inputValue: string;
  onInputValueChange: (query: string) => void;
  groups: Array<ComboboxGroup<T>>;
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  getItemText: (item: T) => string;
  status: ComboboxStatus;
  onRetry?: () => void;
  minChars?: number;
  footer?: React.ReactNode;
  labels: ComboboxLabels;
  placeholder?: string;
  size?: 'default' | 'sm';
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  contentClassName?: string;
  align?: 'start' | 'end';
  emptyQueryContent?: React.ReactNode;
  hint?: React.ReactNode;
  onEnterWithoutHighlight?: (query: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

interface FlatItem<T> {
  item: T;
  key: string;
  compositeKey: string;
  optionId: string;
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  ref.current = value;
}

function groupCount<T>(groups: Array<ComboboxGroup<T>>) {
  return groups.reduce((count, group) => count + group.items.length, 0);
}

export function Combobox<T>({
  mode,
  value = null,
  onValueChange,
  onSelect,
  inputValue,
  onInputValueChange,
  groups,
  getKey,
  renderItem,
  getItemText,
  status,
  onRetry,
  minChars = 1,
  footer,
  labels,
  placeholder,
  size = 'default',
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  autoFocus,
  disabled,
  contentClassName,
  align = 'start',
  emptyQueryContent,
  hint,
  onEnterWithoutHighlight,
  inputRef,
}: ComboboxProps<T>) {
  const generatedId = React.useId();
  const inputId = id ?? `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const [focused, setFocused] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [isEditingSelection, setIsEditingSelection] = React.useState(false);
  const internalInputRef = React.useRef<HTMLInputElement>(null);
  const lastGroupsRef = React.useRef(groups);

  const query = inputValue.trim();
  const currentCount = groupCount(groups);

  React.useEffect(() => {
    if (status === 'success') {
      lastGroupsRef.current = groups;
    }
  }, [groups, status]);

  const displayGroups = status === 'loading' && currentCount === 0 ? lastGroupsRef.current : groups;
  const displayCount = groupCount(displayGroups);
  const showsEmptyQueryContent = focused && inputValue.length === 0 && Boolean(emptyQueryContent);
  const canOpenForQuery = focused && query.length >= minChars;
  const shouldOpen =
    !disabled && focused && (Boolean(hint) || showsEmptyQueryContent || canOpenForQuery);
  const open = shouldOpen && !dismissed;

  React.useEffect(() => {
    if (!shouldOpen) {
      setActiveIndex(-1);
      setDismissed(false);
    }
  }, [shouldOpen]);

  const flatItems = React.useMemo<Array<FlatItem<T>>>(() => {
    const items: Array<FlatItem<T>> = [];
    displayGroups.forEach((group) => {
      group.items.forEach((item, itemIndex) => {
        const key = getKey(item);
        const compositeKey = `${group.key}\u0000${key}\u0000${itemIndex}`;
        items.push({
          item,
          key,
          compositeKey,
          optionId: `${generatedId}-option-${items.length}`,
        });
      });
    });
    return items;
  }, [displayGroups, generatedId, getKey]);

  const flatItemsByCompositeKey = React.useMemo(() => {
    return new Map(flatItems.map((item, index) => [item.compositeKey, { ...item, index }]));
  }, [flatItems]);

  React.useEffect(() => {
    if (activeIndex >= flatItems.length) {
      setActiveIndex(-1);
    }
  }, [activeIndex, flatItems.length]);

  const selectedKey = value == null ? null : getKey(value);
  const displayValue =
    mode === 'select' && value != null && !isEditingSelection && inputValue.length === 0
      ? getItemText(value)
      : inputValue;
  const activeOptionId = activeIndex >= 0 ? flatItems[activeIndex]?.optionId : undefined;
  const hasListbox = open && !showsEmptyQueryContent && !hint && displayCount > 0;

  function focusInput() {
    internalInputRef.current?.focus();
  }

  function selectItem(item: T) {
    if (mode === 'select') {
      onValueChange?.(item);
      onInputValueChange('');
      setIsEditingSelection(false);
    } else {
      onSelect?.(item);
      onInputValueChange('');
    }
    setActiveIndex(-1);
    setDismissed(true);
    requestAnimationFrame(focusInput);
  }

  function clearValue() {
    onInputValueChange('');
    setIsEditingSelection(false);
    if (mode === 'select') {
      onValueChange?.(null);
    }
    setActiveIndex(-1);
    setDismissed(false);
    requestAnimationFrame(focusInput);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (mode === 'select' && value != null) {
      setIsEditingSelection(true);
    }
    onInputValueChange(event.target.value);
    setActiveIndex(-1);
    setDismissed(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        if (flatItems.length > 0 && shouldOpen) {
          setDismissed(false);
        }
        return;
      }
      setActiveIndex((index) => {
        if (flatItems.length === 0 || index >= flatItems.length - 1) return -1;
        return index + 1;
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        if (flatItems.length > 0 && shouldOpen) {
          setDismissed(false);
        }
        return;
      }
      setActiveIndex((index) => (index <= 0 ? -1 : index - 1));
      return;
    }

    if (event.key === 'Enter') {
      if (status === 'error' && activeIndex < 0 && onRetry) {
        event.preventDefault();
        onRetry();
        return;
      }
      if (activeIndex >= 0 && flatItems[activeIndex]) {
        event.preventDefault();
        selectItem(flatItems[activeIndex].item);
        return;
      }
      if (mode === 'navigate' && onEnterWithoutHighlight) {
        event.preventDefault();
        onEnterWithoutHighlight(inputValue);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (open) {
        setDismissed(true);
        setActiveIndex(-1);
        if (mode === 'select' && value != null) {
          setIsEditingSelection(false);
          onInputValueChange('');
        }
      } else {
        clearValue();
      }
      return;
    }

    if (event.key === 'Tab') {
      setDismissed(true);
      setActiveIndex(-1);
    }
  }

  const statusContent = (() => {
    if (hint) return hint;
    if (status === 'loading') return labels.loading;
    if (status === 'error') {
      return (
        <span className="inline-flex items-center gap-2">
          {labels.error}
          {onRetry ? (
            <button
              type="button"
              className="font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onRetry}
            >
              {labels.retry}
            </button>
          ) : null}
        </span>
      );
    }
    if (status === 'success') {
      return displayCount > 0 ? labels.resultsCount(displayCount) : labels.empty;
    }
    return null;
  })();

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setDismissed(true);
          setActiveIndex(-1);
        } else {
          setDismissed(false);
        }
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
            aria-hidden="true"
          />
          <input
            id={inputId}
            ref={(node) => {
              internalInputRef.current = node;
              setRef(inputRef, node);
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={hasListbox}
            aria-controls={hasListbox ? listboxId : undefined}
            aria-activedescendant={activeOptionId}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={placeholder}
            value={displayValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => {
              setFocused(false);
              setActiveIndex(-1);
            }}
            className={cn(controlBase, size === 'sm' && controlSm, 'pl-9 pr-9')}
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
            {status === 'loading' ? (
              <Loader2
                className="size-4 animate-spin text-neutral-500 motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : displayValue.length > 0 || value != null ? (
              <button
                type="button"
                aria-label={labels.clear}
                className="inline-flex size-6 items-center justify-center rounded-sm text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={clearValue}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          // DismissableLayer listens for Escape on `document` in the capture
          // phase and dismisses before the input's keydown. Cancelling that
          // leaves the two-step Escape behaviour (close, then clear or restore)
          // with the input, which still sees the list as open.
          onEscapeKeyDown={(event) => event.preventDefault()}
          className={cn(
            popoverSurface,
            'w-[var(--radix-popover-trigger-width)] p-0',
            contentClassName,
          )}
        >
          {showsEmptyQueryContent ? (
            <div role="status" className="px-3 py-2 text-sm text-neutral-600">
              {emptyQueryContent}
            </div>
          ) : hint ? (
            <div role="status" className="px-3 py-2 text-sm text-neutral-600">
              {hint}
            </div>
          ) : (
            <>
              {displayCount > 0 ? (
                <div
                  id={listboxId}
                  role="listbox"
                  className="max-h-80 overflow-y-auto p-1"
                  onMouseLeave={() => setActiveIndex(-1)}
                >
                  {displayGroups.map((group) => (
                    <div key={group.key} role="group" aria-label={group.label}>
                      {group.label ? (
                        <div className="px-2 py-1.5 text-xs font-medium text-neutral-500">
                          {group.label}
                        </div>
                      ) : null}
                      {group.items.map((item, itemIndex) => {
                        const key = getKey(item);
                        const compositeKey = `${group.key}\u0000${key}\u0000${itemIndex}`;
                        const flatItem = flatItemsByCompositeKey.get(compositeKey);
                        const index = flatItem?.index ?? -1;
                        const highlighted = index >= 0 && index === activeIndex;
                        const selected = selectedKey === key;
                        return (
                          <div
                            key={compositeKey}
                            id={flatItem?.optionId}
                            role="option"
                            aria-selected={selected}
                            data-highlighted={highlighted ? '' : undefined}
                            data-selected={selected ? 'true' : undefined}
                            className={cn(optionBase, 'pl-2')}
                            onMouseEnter={() => setActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectItem(item)}
                          >
                            <span className="min-w-0 flex-1">{renderItem(item)}</span>
                            {mode === 'select' && selected ? (
                              <Check
                                className="size-4 shrink-0 text-brand-600"
                                aria-hidden="true"
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : null}
              {statusContent ? (
                <div role="status" className="px-3 py-2 text-sm text-neutral-600">
                  {statusContent}
                </div>
              ) : null}
            </>
          )}
          {footer ? <div className="border-t border-neutral-200 p-1">{footer}</div> : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
