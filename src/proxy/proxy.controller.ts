import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { walletError } from '../common/wallet-error';
import { JsonRpcRequest, ProxyService } from './proxy.service';

@ApiTags('proxy')
@Controller('wallet')
export class ProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Get('esplora/:blockchain/*')
  async esplora(@Param('blockchain') blockchain: string, @Req() request: Request, @Res() response: Response) {
    const path = this.relativeEsploraPath(request.path);
    const queryIndex = request.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? request.originalUrl.slice(queryIndex) : '';
    const result = await this.proxy.esploraGet(blockchain, path, query);
    return this.writeResponse(response, result);
  }

  @Post('esplora/:blockchain/tx')
  async esploraTransaction(
    @Param('blockchain') blockchain: string,
    @Req() request: Request & { rawBody?: Buffer },
    @Res() response: Response,
  ) {
    const rawBody = request.rawBody ?? request.body;
    const raw = Buffer.isBuffer(rawBody)
      ? rawBody
      : typeof rawBody === 'string'
        ? Buffer.from(rawBody, 'utf8')
        : Buffer.alloc(0);
    const result = await this.proxy.esploraPostTransaction(blockchain, raw);
    return this.writeResponse(response, result);
  }

  @Post('evm/:chainId/rpc')
  @HttpCode(200)
  evm(@Param('chainId') chainId: string, @Body() body: JsonRpcRequest | JsonRpcRequest[]) {
    return this.proxy.evmRpc(chainId, body);
  }

  private relativeEsploraPath(fullPath: string): string {
    const marker = '/esplora/';
    const index = fullPath.indexOf(marker);
    if (index < 0) {
      throw walletError(400, 'EsploraPathInvalid');
    }
    const remainder = fullPath.slice(index + marker.length);
    const slash = remainder.indexOf('/');
    return (slash < 0 ? '' : remainder.slice(slash + 1)).replace(/\/+$/, '');
  }

  private writeResponse(
    response: Response,
    result: { status: number; headers: Record<string, string>; body: Uint8Array },
  ) {
    const contentType = result.headers['content-type'];
    if (contentType) {
      response.setHeader('content-type', contentType);
    }
    if (result.headers['cache-control']) {
      response.setHeader('cache-control', result.headers['cache-control']);
    }
    if (result.headers['etag']) {
      response.setHeader('etag', result.headers['etag']);
    }
    response.status(result.status).send(Buffer.from(result.body));
  }
}
