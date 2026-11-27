/**
 * Focus, then retry for 500ms. Taro H5 often focuses the control and then
 * blurs to BODY on the same tick (CH-301 §2 / §4). If focus is still on
 * BODY within the hold window, put it back.
 *
 * Kept local after switching buttons to `@repo/ui-mini` FocusableButton,
 * because the shared helper does not include this hold.
 */
const HOLD_MS = [0, 16, 50, 100, 200, 400, 500];

export function focusWhenSettled(getEl: () => HTMLElement | null): () => void {
  if (typeof document === 'undefined') return () => undefined;
  let cancelled = false;
  const started = Date.now();
  const tryFocus = () => {
    if (cancelled) return;
    const el = getEl();
    if (!el) return;
    const active = document.activeElement;
    if (active === el || (active && el.contains(active))) return;
    const panel = el.closest('.card-comment__confirm, .report-entry__form');
    if (panel && active && panel.contains(active)) return;
    if (
      active &&
      active !== document.body &&
      active !== document.documentElement &&
      Date.now() - started > 80
    ) {
      return;
    }
    el.focus();
  };
  tryFocus();
  const timers = HOLD_MS.map((ms) => window.setTimeout(tryFocus, ms));
  const onFocusOut = () => {
    if (cancelled || Date.now() - started > 500) return;
    const active = document.activeElement;
    if (active === document.body || active === document.documentElement || !active) {
      tryFocus();
    }
  };
  document.addEventListener('focusout', onFocusOut, true);
  return () => {
    cancelled = true;
    timers.forEach((id) => window.clearTimeout(id));
    document.removeEventListener('focusout', onFocusOut, true);
  };
}
