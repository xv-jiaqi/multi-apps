import type { ContentSecurityService, EvaluateWriteResult } from './content-security.service';

const defaultDecision: EvaluateWriteResult = {
  safetyStatus: 'UNCHECKED',
  textResult: 'unchecked',
  excerpt: '',
  pendingMedia: [],
  openid: null,
};

/** Router unit tests that do not exercise safety still write as unchecked. */
export function stubContentSecurity(
  overrides: Partial<ContentSecurityService> = {},
): ContentSecurityService {
  const stub = {
    evaluateWrite: jest.fn().mockResolvedValue(defaultDecision),
    finalizeWrite: jest.fn().mockResolvedValue(undefined),
    handleMediaCallback: jest.fn().mockResolvedValue(undefined),
    recordMiniappVisit: jest.fn().mockResolvedValue(undefined),
    useTestHooks: jest.fn(),
    ...overrides,
  };
  return stub as unknown as ContentSecurityService;
}
