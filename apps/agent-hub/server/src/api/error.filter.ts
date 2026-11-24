// server/src/api/error.filter.ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';
import { requestIdOf, sendApiError } from './http-pipeline';

export interface ErrorLogger {
  error(msg: string, meta: Record<string, unknown>): void;
}

/** 全局过滤器：所有错误响应都是 ApiErrorBody。 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: ErrorLogger) {}

  catch(err: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;
    if (err instanceof ApiError) return sendApiError(res, err);
    if (err instanceof HttpException && err.getStatus() === 404) {
      return sendApiError(res, new ApiError('NOT_FOUND', '接口不存在'));
    }
    const requestId = requestIdOf(req);
    this.logger.error('未处理的错误', { requestId, method: req.method, path: req.path, err });
    sendApiError(res, new ApiError('INTERNAL', '内部错误，详情见侧车日志', { requestId }));
  }
}
