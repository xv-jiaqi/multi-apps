import { describe, expect, it } from 'vitest';
import { isPublicSafetyStatus, SUBMITTED_FOR_REVIEW_KEY } from './post-safety';

describe('isPublicSafetyStatus', () => {
  it('is true only for pass', () => {
    expect(isPublicSafetyStatus('pass')).toBe(true);
    expect(isPublicSafetyStatus('unchecked')).toBe(false);
    expect(isPublicSafetyStatus('review')).toBe(false);
    expect(isPublicSafetyStatus('blocked')).toBe(false);
    expect(isPublicSafetyStatus('risky')).toBe(false);
    expect(isPublicSafetyStatus(undefined)).toBe(false);
    expect(isPublicSafetyStatus(null)).toBe(false);
    expect(isPublicSafetyStatus('')).toBe(false);
  });

  it('uses the shared submitted-for-review copy key', () => {
    expect(SUBMITTED_FOR_REVIEW_KEY).toBe('content.submittedForReview');
  });
});
