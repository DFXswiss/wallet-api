import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { walletError } from '../common/wallet-error';
import { HTTP_TRANSPORT, HttpTransport, OutboundResponse } from '../outbound/http-transport';
import { isValidEsploraPath, isValidEsploraQuery, parseHttpsOriginMap, parseHttpsUrlMap } from './proxy-config';

export const EVM_MAX_BATCH = 16;

export const EVM_ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionReceipt',
  'eth_sendRawTransaction',
  'net_version',
]);

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown[];
};

@Injectable()
export class ProxyService {
  constructor(
    private readonly config: ConfigService,
    @Inject(HTTP_TRANSPORT) private readonly transport: HttpTransport,
  ) {}

  get esploraBases(): Record<string, string> {
    return parseHttpsOriginMap(this.config.get<string>('ESPLORA_BASE_URLS'));
  }

  get evmUrls(): Record<string, string> {
    return parseHttpsUrlMap(this.config.get<string>('EVM_RPC_URLS'));
  }

  async esploraGet(blockchain: string, path: string, query = ''): Promise<OutboundResponse> {
    const base = this.esploraBases[blockchain];
    if (!base) {
      throw walletError(404, 'EsploraNotConfigured');
    }
    if (!isValidEsploraPath(path)) {
      throw walletError(400, 'EsploraPathInvalid');
    }
    if (!isValidEsploraQuery(query)) {
      throw walletError(400, 'EsploraPathInvalid');
    }
    try {
      return await this.forward(`${base}/${path}${query}`);
    } catch (error) {
      if (isWalletHttpException(error)) {
        throw error;
      }
      throw walletError(502, 'OutboundRequestFailed');
    }
  }

  async esploraPostTransaction(blockchain: string, body: Buffer): Promise<OutboundResponse> {
    const base = this.esploraBases[blockchain];
    if (!base) {
      throw walletError(404, 'EsploraNotConfigured');
    }
    if (body.length === 0) {
      throw walletError(400, 'EsploraTransactionInvalid');
    }
    try {
      return await this.forward(`${base}/tx`, 'POST', body, 'text/plain');
    } catch (error) {
      if (isWalletHttpException(error)) {
        throw error;
      }
      throw walletError(502, 'OutboundRequestFailed');
    }
  }

  async evmRpc(chainId: string, body: JsonRpcRequest | JsonRpcRequest[]): Promise<unknown> {
    const endpoint = this.evmUrls[chainId];
    if (!endpoint) {
      throw walletError(404, 'EvmChainNotFound');
    }
    const calls = Array.isArray(body) ? body : [body];
    if (calls.length === 0 || calls.length > EVM_MAX_BATCH || calls.some((call) => !call || typeof call !== 'object')) {
      throw walletError(400, 'EvmMethodNotAllowed');
    }
    for (const call of calls) {
      if (typeof call.method !== 'string' || !EVM_ALLOWED_METHODS.has(call.method)) {
        throw walletError(400, 'EvmMethodNotAllowed');
      }
      if (call.params !== undefined && !Array.isArray(call.params)) {
        throw walletError(400, 'EvmMethodNotAllowed');
      }
    }
    let response;
    try {
      response = await this.transport.request({
        url: endpoint,
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 15_000,
        maxBytes: 1024 * 1024,
      });
    } catch {
      throw walletError(502, 'OutboundRequestFailed');
    }
    try {
      return JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown;
    } catch {
      throw walletError(502, 'OutboundRequestFailed');
    }
  }

  get ethereumRpc(): string | undefined {
    return this.evmUrls['1'];
  }

  async ethereumEthCall(to: string, data: string): Promise<unknown> {
    return this.evmRpc('1', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] });
  }

  private async forward(url: string, method: 'GET' | 'POST' = 'GET', body?: Buffer, contentType?: string) {
    const response = await this.transport.request({
      url,
      method,
      headers: {
        accept: 'application/json',
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      body,
      timeoutMs: 15_000,
      maxBytes: 10 * 1024 * 1024,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }
}

function isWalletHttpException(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'getStatus' in error);
}
