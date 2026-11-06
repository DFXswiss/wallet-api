import { HttpException } from '@nestjs/common';
import { WalletExceptionFilter, walletParserErrorMiddleware } from '../src/common/wallet-exception.filter';

function respond(exception: unknown): { status: number; body: unknown } {
  let status: number | undefined;
  let body: unknown;
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (next: number) => {
          status = next;
          return {
            json: (payload: unknown) => {
              body = payload;
            },
          };
        },
      }),
    }),
  };
  new WalletExceptionFilter().catch(exception, host as any);
  if (status === undefined) {
    throw new Error('filter did not set a status');
  }
  return { status, body };
}

describe('wallet exception filter', () => {
  it('keeps the code and status of an HttpException', () => {
    expect(respond(new HttpException({ code: 'AddressConflict', message: 'taken' }, 409))).toEqual({
      status: 409,
      body: { statusCode: 409, code: 'AddressConflict', message: 'AddressConflict' },
    });
  });

  it('maps entity.parse.failed with status 400 to BadRequest', () => {
    const body = { statusCode: 400, code: 'BadRequest', message: 'BadRequest' };
    expect(respond({ type: 'entity.parse.failed', status: 400, message: 'invalid json' })).toEqual({
      status: 400,
      body,
    });
    expect(respond({ type: 'entity.parse.failed', statusCode: 400, message: 'invalid json' })).toEqual({
      status: 400,
      body,
    });
  });

  it('maps entity.too.large with status 413 to PayloadTooLarge', () => {
    const body = { statusCode: 413, code: 'PayloadTooLarge', message: 'PayloadTooLarge' };
    expect(respond({ type: 'entity.too.large', status: 413, message: 'request entity too large' })).toEqual({
      status: 413,
      body,
    });
    expect(respond({ type: 'entity.too.large', statusCode: 413, message: 'request entity too large' })).toEqual({
      status: 413,
      body,
    });
  });

  it('returns InternalServerError for a plain Error', () => {
    expect(respond(new Error('failed'))).toEqual({
      status: 500,
      body: { statusCode: 500, code: 'InternalServerError', message: 'InternalServerError' },
    });
  });

  it('returns InternalServerError for a SyntaxError with status 400 and a different type', () => {
    const exception = new SyntaxError('Unexpected token');
    Object.assign(exception, { status: 400, type: 'syntax.error' });
    expect(respond(exception)).toEqual({
      status: 500,
      body: { statusCode: 500, code: 'InternalServerError', message: 'InternalServerError' },
    });
  });

  it('returns InternalServerError when entity.parse.failed does not carry status 400', () => {
    expect(respond({ type: 'entity.parse.failed', status: 500, message: 'invalid json' })).toEqual({
      status: 500,
      body: { statusCode: 500, code: 'InternalServerError', message: 'InternalServerError' },
    });
  });

  it('maps a parser error through the Express error middleware', () => {
    const middleware = walletParserErrorMiddleware(new WalletExceptionFilter());
    expect(middleware).toHaveLength(4);
    let status: number | undefined;
    let body: unknown;
    const response = {
      headersSent: false,
      status: (next: number) => {
        status = next;
        return {
          json: (payload: unknown) => {
            body = payload;
          },
        };
      },
    };
    const next = jest.fn();
    middleware({ type: 'entity.parse.failed', status: 400, statusCode: 400 }, {} as any, response as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(400);
    expect(body).toEqual({ statusCode: 400, code: 'BadRequest', message: 'BadRequest' });
  });

  it('leaves a parser error alone once headers are sent', () => {
    const middleware = walletParserErrorMiddleware(new WalletExceptionFilter());
    const error = { type: 'entity.parse.failed', status: 400, statusCode: 400 };
    const next = jest.fn();
    middleware(error, {} as any, { headersSent: true, status: jest.fn() } as any, next);
    expect(next).toHaveBeenCalledWith(error);
  });

  it('returns InternalServerError when status and statusCode disagree', () => {
    const body = { statusCode: 500, code: 'InternalServerError', message: 'InternalServerError' };
    expect(respond({ type: 'entity.parse.failed', status: 400, statusCode: 413 })).toEqual({ status: 500, body });
    expect(respond({ type: 'entity.too.large', status: 413, statusCode: 400 })).toEqual({ status: 500, body });
  });
});
