import { ConfigService } from '@nestjs/config';
import { PricesService } from '../src/prices/prices.service';
import { LnurlService } from '../src/lnurl/lnurl.service';
import { SafeFetchService } from '../src/outbound/safe-fetch.service';

function safeFetchWith(resolver: { resolve: jest.Mock }, transport?: { request: jest.Mock }): SafeFetchService {
  return new SafeFetchService((transport ?? { request: jest.fn() }) as any, resolver as any);
}

describe('prices and LNURL configuration', () => {
  it('returns 503 for prices without WALLET_PRICE_URL', async () => {
    const config = new ConfigService({ WALLET_PRICE_HOSTS: 'prices.example.com' });
    const service = new PricesService(config, safeFetchWith({ resolve: jest.fn() }));
    await expect(service.prices()).rejects.toMatchObject({ status: 503 });
  });

  it('returns 503 when the price host is not allow-listed', async () => {
    const config = new ConfigService({
      WALLET_PRICE_URL: 'https://prices.example.com/v1/rates',
      WALLET_PRICE_HOSTS: 'other.example.com',
    });
    const service = new PricesService(config, safeFetchWith({ resolve: jest.fn() }));
    await expect(service.prices()).rejects.toMatchObject({ status: 503 });
  });

  it('refuses an LNURL http URL without opening a socket', async () => {
    const transport = { request: jest.fn() };
    const service = new LnurlService(safeFetchWith({ resolve: jest.fn() }, transport));
    await expect(service.resolve('http://example.com/lnurl')).rejects.toMatchObject({ status: 400 });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('refuses a loopback LNURL URL without opening a socket', async () => {
    const transport = { request: jest.fn() };
    const service = new LnurlService(safeFetchWith({ resolve: jest.fn() }, transport));
    await expect(service.resolve('https://127.0.0.1/lnurl')).rejects.toMatchObject({ status: 400 });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('allows a public IP literal without DNS', async () => {
    const transport = {
      request: jest.fn(async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{}'),
      })),
    };
    const resolver = { resolve: jest.fn() };
    const service = new LnurlService(safeFetchWith(resolver, transport));
    await expect(service.resolve('https://8.8.8.8/lnurl')).resolves.toEqual({});
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('refuses a lightning address local part containing a slash', async () => {
    const transport = { request: jest.fn() };
    const service = new LnurlService(safeFetchWith({ resolve: jest.fn() }, transport));
    await expect(service.lightningAddress('a/b@example.com')).rejects.toMatchObject({ status: 400 });
    expect(transport.request).not.toHaveBeenCalled();
  });
});
