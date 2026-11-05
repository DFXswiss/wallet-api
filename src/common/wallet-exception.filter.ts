import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

type ExceptionBody = {
  statusCode?: number;
  code?: string;
  message?: string | string[];
};

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
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'InternalServerError',
      message: 'InternalServerError',
    });
  }
}
