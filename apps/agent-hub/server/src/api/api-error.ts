// server/src/api/api-error.ts
import {
  API_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
  type JsonValue,
  type ValidationIssue,
} from '@agent-hub/contract';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: JsonValue,
  ) {
    super(message);
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

export function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** 校验失败抛 VALIDATION_FAILED（设置页用 CONFIG_INVALID），details = { issues }。 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  code: 'VALIDATION_FAILED' | 'CONFIG_INVALID' = 'VALIDATION_FAILED',
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = code === 'CONFIG_INVALID' ? '配置不合法' : '请求参数不合法';
    throw new ApiError(code, message, { issues: toIssues(result.error) });
  }
  return result.data;
}
