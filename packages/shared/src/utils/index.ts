// Cross-platform timer: reference `globalThis.setTimeout` through a narrow
// declaration so this file compiles in environments that don't bundle DOM or
// Node type libraries (e.g. miniapp builds).
declare const setTimeout: (handler: () => void, timeout: number) => unknown;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
