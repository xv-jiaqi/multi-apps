/**
 * Shared client helper for write responses: forum topics and replies,
 * trade publish, and card comments. D can reuse this file as well.
 *
 * Only `pass` is publicly visible on the miniapp. `unchecked` (credentials
 * missing or no recent WeChat visit; see content-security.service.ts around
 * the UNCHECKED early return), `review`, `blocked`, and `risky` are not.
 * The visit report that makes a write checkable lives in miniapp-visit.ts.
 *
 * After a non-pass write, show Toast `content.submittedForReview`
 * (CH-301 §4 / §7 v1.5). Do not use or change `content.pendingReview`,
 * which is the "under review" grey label.
 */
export const SUBMITTED_FOR_REVIEW_KEY = 'content.submittedForReview';

export function isPublicSafetyStatus(status: string | null | undefined): boolean {
  return status === 'pass';
}
