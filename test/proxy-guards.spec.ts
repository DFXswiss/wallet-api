import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVM_ALLOWED_METHODS, EVM_MAX_BATCH, ProxyService } from '../src/proxy/proxy.service';
import { isValidEsploraPath } from '../src/proxy/proxy-config';

describe('proxy guards', () => {
  it('refuses traversal and absolute URLs in Esplora paths', () => {
    expect(isValidEsploraPath('../secret')).toBe(false);
    expect(isValidEsploraPath('tx/../secret')).toBe(false);
    expect(isValidEsploraPath('https://evil.invalid/tx')).toBe(false);
    expect(isValidEsploraPath('//evil.invalid/tx')).toBe(false);
    expect(isValidEsploraPath('tx/abc')).toBe(true);
  });

  it('refuses an EVM method outside the allow list before any request', async () => {
    const transport = { request: jest.fn() };
    const config = new ConfigService({ EVM_RPC_URLS: JSON.stringify({ '1': 'https://rpc.example.com' }) });
    const service = new ProxyService(config, transport as any);
    expect(EVM_ALLOWED_METHODS.has('eth_sendRawTransaction')).toBe(true);
    await expect(service.evmRpc('1', { method: 'debug_traceTransaction' })).rejects.toBeInstanceOf(HttpException);
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('refuses an EVM batch above the cap before any request', async () => {
    const transport = {
      request: jest.fn(async () => ({ status: 200, headers: {}, body: Buffer.from('{"result":"0x1"}') })),
    };
    const config = new ConfigService({ EVM_RPC_URLS: JSON.stringify({ '1': 'https://rpc.example.com' }) });
    const service = new ProxyService(config, transport as any);
    const call = { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] };
    await expect(service.evmRpc('1', [])).rejects.toMatchObject({ status: 400 });
    await expect(
      service.evmRpc(
        '1',
        Array.from({ length: EVM_MAX_BATCH + 1 }, () => call),
      ),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(transport.request).not.toHaveBeenCalled();
    await expect(
      service.evmRpc(
        '1',
        Array.from({ length: EVM_MAX_BATCH }, () => call),
      ),
    ).resolves.toEqual({
      result: '0x1',
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an unknown EVM chain id', async () => {
    const config = new ConfigService({ EVM_RPC_URLS: JSON.stringify({ '1': 'https://rpc.example.com' }) });
    const service = new ProxyService(config, { request: jest.fn() } as any);
    await expect(service.evmRpc('137', { method: 'eth_chainId' })).rejects.toMatchObject({ status: 404 });
  });
});
