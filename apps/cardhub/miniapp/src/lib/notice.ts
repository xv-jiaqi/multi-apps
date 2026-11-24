/**
 * A message that screen readers must announce again even when the text
 * repeats (cardhub-pr-checklist A.7). Render with `key={notice.id}`.
 */
export type Notice<T> = { id: number } & T;

let lastNoticeId = 0;

export function nextNoticeId(): number {
  lastNoticeId += 1;
  return lastNoticeId;
}
