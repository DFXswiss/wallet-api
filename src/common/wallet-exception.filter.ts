import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

type ExceptionBody = {
  statusCode?: number;
  code?: string;
  message?: string | string[];
};

type ReportedError = {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function bodyParserFailure(exception: unknown): { statusCode: number; code: string } | null {
  if (typeof exception !== 'object' || exception === null) {
    return null;
  }
  const error = exception as ReportedError;
  if (error.type === 'entity.parse.failed' && statusAgrees(error, HttpStatus.BAD_REQUEST)) {
    return { statusCode: HttpStatus.BAD_REQUEST, code: 'BadRequest' };
  }
  if (error.type === 'entity.too.large' && statusAgrees(error, HttpStatus.PAYLOAD_TOO_LARGE)) {
    return { statusCode: HttpStatus.PAYLOAD_TOO_LARGE, code: 'PayloadTooLarge' };
  }
  return null;
}

function statusAgrees(error: ReportedError, expected: number): boolean {
  const statusMatches = error.status === expected;
  const statusCodeMatches = error.statusCode === expected;
  const statusConflicts = typeof error.status === 'number' && error.status !== expected;
  const statusCodeConflicts = typeof error.statusCode === 'number' && error.statusCode !== expected;
  return (statusMatches || statusCodeMatches) && !statusConflicts && !statusCodeConflicts;
}

export function walletParserErrorMiddleware(
  filter: WalletExceptionFilter,
): (error: unknown, request: Request, response: Response, next: NextFunction) => void {
  return (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    filter.catch(error, {
      switchToHttp: () => ({ getResponse: () => response }),
    } as ArgumentsHost);
  };
}

@Catch()
export class WalletExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const original = exception.getResponse();
      if (typeof original === 'object' && original !== null) {
        const body = original as ExceptionBody;
        if (body.code) {
          response.status(status).json({ statusCode: status, code: body.code, message: body.code });
          return;
        }
        if (body.message && status === HttpStatus.BAD_REQUEST) {
          response.status(status).json({ statusCode: status, code: 'BadRequest', message: body.message });
          return;
        }
      }
      response.status(status).json({ statusCode: status, code: 'HttpError', message: exception.message });
      return;
    }
    const parsed = bodyParserFailure(exception);
    if (parsed) {
      response.status(parsed.statusCode).json({
        statusCode: parsed.statusCode,
        code: parsed.code,
        message: parsed.code,
      });
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'InternalServerError',
      message: 'InternalServerError',
    });
  }
}
