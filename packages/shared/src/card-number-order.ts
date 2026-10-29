/**
 * Checklist order for a printed card number.
 *
 * The first contiguous digit run is the integer. Leading zeros do not change
 * that integer. Everything else — the letter prefix and whatever follows the
 * digits — is compared only after the integer. Empty numbers sort last.
 * A non-empty value with no digits (for example `PROMO`) sorts after numbered
 * cards and before empty ones. Equal keys are not distinguished here; callers
 * add a stable id tie-break.
 *
 * Digit strings are compared by length and code units after stripping leading
 * zeros, so values past `Number.MAX_SAFE_INTEGER` stay in numeric order.
 */

export type CardNumberGroup = 'number' | 'text' | 'empty';

export type CardNumberKey = {
  group: CardNumberGroup;
  digits: string;
  rest: string;
  raw: string;
};

const NUMBERED = /^(\D*)(\d+)(.*)$/;

function normalizedDigits(digits: string): string {
  const stripped = digits.replace(/^0+/, '');
  return stripped.length > 0 ? stripped : '0';
}

export function cardNumberKey(value: string | null | undefined): CardNumberKey {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { group: 'empty', digits: '', rest: '', raw: '' };
  const match = NUMBERED.exec(raw);
  if (!match) return { group: 'text', digits: '', rest: raw, raw };
  const prefix = match[1] ?? '';
  const digits = match[2] ?? '';
  const suffix = match[3] ?? '';
  return {
    group: 'number',
    digits: normalizedDigits(digits),
    rest: `${prefix}${suffix}`,
    raw,
  };
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

const GROUP_ORDER: Record<CardNumberGroup, number> = {
  number: 0,
  text: 1,
  empty: 2,
};

export function compareCardNumbers(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = cardNumberKey(left);
  const b = cardNumberKey(right);
  if (a.group !== b.group) return GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
  if (a.group === 'number') {
    if (a.digits.length !== b.digits.length) return a.digits.length - b.digits.length;
    const byDigits = compareText(a.digits, b.digits);
    if (byDigits !== 0) return byDigits;
  }
  const byRest = compareText(a.rest, b.rest);
  if (byRest !== 0) return byRest;
  return compareText(a.raw, b.raw);
}
