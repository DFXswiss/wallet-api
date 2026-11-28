import { ConfigService } from '@nestjs/config';
import { readWalletRuntimeConfig, validateEnvironment } from '../src/config/environment';
import {
  assertEsploraRegtestConfig,
  parseEsploraRegtestOrigin,
  resolveEsploraRegtestOrigin,
} from '../src/proxy/esplora-regtest';
import { ProxyService } from '../src/proxy/proxy.service';
import { allFamiliesOff, launchFamilies } from './wallet-families.fixtures';

const REGTEST_HTTP = 'http://regtest-esplora.example:3000';
const REGTEST_HTTPS = 'https://regtest-esplora.example';

const baseEnv = {
  DATABASE_URL: 'postgres://wallet:wallet@127.0.0.1:5432/wallet',
  WALLET_SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
};

function okTransport() {
  return {
    request: jest.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{}'),
    })),
  };
}

function service(values: Record<string, string>, transport = okTransport(), families = launchFamilies()) {
  return { proxy: new ProxyService(new ConfigService(values), transport as any, families), transport };
}

describe('ESPLORA_REGTEST_URL parsing', () => {
  it('accepts http and https origins, with or without a trailing slash', () => {
    expect(parseEsploraRegtestOrigin(REGTEST_HTTP)).toBe(REGTEST_HTTP);
    expect(parseEsploraRegtestOrigin(`${REGTEST_HTTP}/`)).toBe(REGTEST_HTTP);
    expect(parseEsploraRegtestOrigin(REGTEST_HTTPS)).toBe(REGTEST_HTTPS);
    expect(parseEsploraRegtestOrigin(`${REGTEST_HTTPS}/`)).toBe(REGTEST_HTTPS);
  });

  it('treats unset and empty as not configured', () => {
    expect(parseEsploraRegtestOrigin(undefined)).toBeUndefined();
    expect(parseEsploraRegtestOrigin('')).toBeUndefined();
  });

  it.each([
    ['a path', `${REGTEST_HTTP}/api`],
    ['a nested path', `${REGTEST_HTTP}/api/`],
    ['credentials', 'http://user:pass@regtest-esplora.example:3000'],
    ['a user name', 'http://user@regtest-esplora.example:3000'],
    ['a query', `${REGTEST_HTTP}/?network=regtest`],
    ['an empty query', `${REGTEST_HTTP}?`],
    ['a fragment', `${REGTEST_HTTP}/#tx`],
    ['a non-http scheme', 'ftp://regtest-esplora.example:3000'],
    ['a websocket scheme', 'ws://regtest-esplora.example:3000'],
    ['a file URL', 'file:///etc/passwd'],
    ['no scheme', 'regtest-esplora.example:3000'],
    ['garbage', 'not a url'],
    ['surrounding whitespace', ` ${REGTEST_HTTP}`],
  ])('rejects %s', (_label, value) => {
    expect(() => parseEsploraRegtestOrigin(value)).toThrow(/ESPLORA_REGTEST_URL/);
  });

  it('does not echo a rejected value in the error', () => {
    let message = '';
    try {
      parseEsploraRegtestOrigin('http://user:hunter2@regtest-esplora.example');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ESPLORA_REGTEST_URL/);
    expect(message).not.toContain('hunter2');
  });

  it('rejects a non-string value', () => {
    expect(() => parseEsploraRegtestOrigin(3000)).toThrow(/ESPLORA_REGTEST_URL/);
  });
});

describe('regtest boot check', () => {
  it('fails prd boot when ESPLORA_REGTEST_URL is set', () => {
    expect(() => assertEsploraRegtestConfig('prd', { ESPLORA_REGTEST_URL: REGTEST_HTTPS })).toThrow(
      /ESPLORA_REGTEST_URL must not be set when ENVIRONMENT is prd/,
    );
    expect(() =>
      readWalletRuntimeConfig({ ...baseEnv, ENVIRONMENT: 'prd', ESPLORA_REGTEST_URL: REGTEST_HTTP }),
    ).toThrow(/ESPLORA_REGTEST_URL/);
    expect(() => validateEnvironment({ ...baseEnv, ENVIRONMENT: 'prd', ESPLORA_REGTEST_URL: REGTEST_HTTP })).toThrow(
      /ESPLORA_REGTEST_URL/,
    );
  });

  it('fails prd boot when ESPLORA_REGTEST_URL is set but invalid', () => {
    expect(() => validateEnvironment({ ...baseEnv, ENVIRONMENT: 'prd', ESPLORA_REGTEST_URL: 'not a url' })).toThrow(
      /ESPLORA_REGTEST_URL/,
    );
  });

  it('fails prd boot when ESPLORA_BASE_URLS contains BitcoinRegtest', () => {
    const ESPLORA_BASE_URLS = JSON.stringify({
      Bitcoin: 'https://esplora.example.com',
      BitcoinRegtest: REGTEST_HTTPS,
    });
    expect(() => readWalletRuntimeConfig({ ...baseEnv, ENVIRONMENT: 'prd', ESPLORA_BASE_URLS })).toThrow(
      /ESPLORA_BASE_URLS must not contain BitcoinRegtest/,
    );
    expect(() => validateEnvironment({ ...baseEnv, ENVIRONMENT: 'prd', ESPLORA_BASE_URLS })).toThrow(
      /ESPLORA_BASE_URLS must not contain BitcoinRegtest/,
    );
  });

  it.each(['stg', 'dev', 'loc'])('fails %s boot when ESPLORA_BASE_URLS contains BitcoinRegtest', (environment) => {
    const ESPLORA_BASE_URLS = JSON.stringify({ BitcoinRegtest: REGTEST_HTTPS });
    expect(() => validateEnvironment({ ...baseEnv, ENVIRONMENT: environment, ESPLORA_BASE_URLS })).toThrow(
      /ESPLORA_BASE_URLS must not contain BitcoinRegtest/,
    );
  });

  it.each(['stg', 'dev', 'loc'])('fails %s boot on an invalid ESPLORA_REGTEST_URL', (environment) => {
    expect(() =>
      readWalletRuntimeConfig({ ...baseEnv, ENVIRONMENT: environment, ESPLORA_REGTEST_URL: `${REGTEST_HTTP}/api` }),
    ).toThrow(/ESPLORA_REGTEST_URL/);
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        ENVIRONMENT: environment,
        ESPLORA_REGTEST_URL: 'ftp://regtest-esplora.example',
      }),
    ).toThrow(/ESPLORA_REGTEST_URL/);
  });

  it.each(['stg', 'dev', 'loc'])('boots %s with a valid ESPLORA_REGTEST_URL', (environment) => {
    expect(() =>
      readWalletRuntimeConfig({ ...baseEnv, ENVIRONMENT: environment, ESPLORA_REGTEST_URL: REGTEST_HTTP }),
    ).not.toThrow();
    expect(() =>
      validateEnvironment({ ...baseEnv, ENVIRONMENT: environment, ESPLORA_REGTEST_URL: REGTEST_HTTPS }),
    ).not.toThrow();
  });

  it('boots prd without regtest settings and keeps the existing ESPLORA_BASE_URLS leniency', () => {
    expect(() => validateEnvironment({ ...baseEnv, ENVIRONMENT: 'prd' })).not.toThrow();
    expect(() => validateEnvironment({ ...baseEnv, ENVIRONMENT: 'prd', ESPLORA_REGTEST_URL: '' })).not.toThrow();
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        ENVIRONMENT: 'prd',
        ESPLORA_BASE_URLS: JSON.stringify({ Bitcoin: 'https://esplora.example.com' }),
      }),
    ).not.toThrow();
    expect(() => validateEnvironment({ ...baseEnv, ENVIRONMENT: 'prd', ESPLORA_BASE_URLS: 'not json' })).not.toThrow();
  });
});

describe('regtest request-time resolution', () => {
  it('never resolves outside stg, dev, and loc', () => {
    expect(resolveEsploraRegtestOrigin('prd', REGTEST_HTTP)).toBeUndefined();
    expect(resolveEsploraRegtestOrigin(undefined, REGTEST_HTTP)).toBeUndefined();
    expect(resolveEsploraRegtestOrigin('production', REGTEST_HTTP)).toBeUndefined();
  });

  it('does not throw on an invalid value at request time', () => {
    expect(resolveEsploraRegtestOrigin('stg', 'ftp://regtest-esplora.example')).toBeUndefined();
  });

  it.each(['stg', 'dev', 'loc'])('resolves on %s', (environment) => {
    expect(resolveEsploraRegtestOrigin(environment, `${REGTEST_HTTP}/`)).toBe(REGTEST_HTTP);
  });
});

describe('regtest Esplora proxy', () => {
  it.each(['stg', 'dev', 'loc'])('forwards GET to the regtest origin on %s', async (environment) => {
    const { proxy, transport } = service({ ENVIRONMENT: environment, ESPLORA_REGTEST_URL: REGTEST_HTTP });
    await expect(proxy.esploraGet('BitcoinRegtest', 'address/bcrt1qexample/utxo', '?limit=5')).resolves.toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${REGTEST_HTTP}/address/bcrt1qexample/utxo?limit=5`, method: 'GET' }),
    );
  });

  it.each(['stg', 'dev', 'loc'])('forwards POST tx to the regtest origin on %s', async (environment) => {
    const { proxy, transport } = service({ ENVIRONMENT: environment, ESPLORA_REGTEST_URL: `${REGTEST_HTTPS}/` });
    const body = Buffer.from('0200000001abcdef');
    await expect(proxy.esploraPostTransaction('BitcoinRegtest', body)).resolves.toMatchObject({ status: 200 });
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${REGTEST_HTTPS}/tx`,
        method: 'POST',
        body,
        headers: expect.objectContaining({ 'content-type': 'text/plain' }),
      }),
    );
  });

  it('answers 404 EsploraNotConfigured on prd even when the variables are present', async () => {
    const { proxy, transport } = service({
      ENVIRONMENT: 'prd',
      ESPLORA_REGTEST_URL: REGTEST_HTTP,
      ESPLORA_BASE_URLS: JSON.stringify({ BitcoinRegtest: REGTEST_HTTPS }),
    });
    await expect(proxy.esploraGet('BitcoinRegtest', 'blocks/tip/height')).rejects.toMatchObject({ status: 404 });
    await expect(proxy.esploraPostTransaction('BitcoinRegtest', Buffer.from('00'))).rejects.toMatchObject({
      status: 404,
    });
    await expect(proxy.esploraGet('BitcoinRegtest', 'blocks/tip/height')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EsploraNotConfigured' }),
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it.each(['stg', 'dev', 'loc'])('answers 404 on %s when ESPLORA_REGTEST_URL is unset', async (environment) => {
    const { proxy, transport } = service({ ENVIRONMENT: environment });
    await expect(proxy.esploraGet('BitcoinRegtest', 'blocks/tip/height')).rejects.toMatchObject({ status: 404 });
    await expect(proxy.esploraPostTransaction('BitcoinRegtest', Buffer.from('00'))).rejects.toMatchObject({
      status: 404,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('never uses a BitcoinRegtest key from ESPLORA_BASE_URLS', async () => {
    const { proxy, transport } = service({
      ENVIRONMENT: 'stg',
      ESPLORA_BASE_URLS: JSON.stringify({ BitcoinRegtest: REGTEST_HTTPS }),
    });
    await expect(proxy.esploraGet('BitcoinRegtest', 'blocks/tip/height')).rejects.toMatchObject({ status: 404 });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('keeps other blockchains on ESPLORA_BASE_URLS, HTTPS only', async () => {
    const { proxy, transport } = service({
      ENVIRONMENT: 'stg',
      ESPLORA_REGTEST_URL: REGTEST_HTTP,
      ESPLORA_BASE_URLS: JSON.stringify({
        Bitcoin: 'https://esplora.example.com',
        Testnet: 'http://esplora.example.com',
      }),
    });
    await proxy.esploraGet('Bitcoin', 'blocks/tip/height');
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://esplora.example.com/blocks/tip/height' }),
    );
    await expect(proxy.esploraGet('Testnet', 'blocks/tip/height')).rejects.toMatchObject({ status: 404 });
  });

  it('applies path, query, and body validation to regtest', async () => {
    const { proxy, transport } = service({ ENVIRONMENT: 'loc', ESPLORA_REGTEST_URL: REGTEST_HTTP });
    await expect(proxy.esploraGet('BitcoinRegtest', '../secret')).rejects.toMatchObject({ status: 400 });
    await expect(proxy.esploraGet('BitcoinRegtest', '//evil.invalid/tx')).rejects.toMatchObject({ status: 400 });
    await expect(proxy.esploraGet('BitcoinRegtest', 'tx/abc', '?a=..')).rejects.toMatchObject({ status: 400 });
    await expect(proxy.esploraPostTransaction('BitcoinRegtest', Buffer.alloc(0))).rejects.toMatchObject({
      status: 400,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('refuses BitcoinRegtest with 403 WalletFamilyDisabled before any lookup when bitcoin is off', async () => {
    const values = { ENVIRONMENT: 'loc', ESPLORA_REGTEST_URL: REGTEST_HTTP };
    const { proxy, transport } = service(values, okTransport(), allFamiliesOff());
    await expect(proxy.esploraGet('BitcoinRegtest', 'blocks/tip/height')).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'WalletFamilyDisabled' }),
    });
    await expect(proxy.esploraPostTransaction('BitcoinRegtest', Buffer.from('00'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(proxy.esploraGet('BitcoinRegtest', '../secret')).rejects.toMatchObject({ status: 403 });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('maps an upstream failure to 502', async () => {
    const transport = { request: jest.fn(async () => Promise.reject(new Error('connect refused'))) };
    const { proxy } = service({ ENVIRONMENT: 'dev', ESPLORA_REGTEST_URL: REGTEST_HTTP }, transport as any);
    await expect(proxy.esploraGet('BitcoinRegtest', 'blocks/tip/height')).rejects.toMatchObject({ status: 502 });
  });
});
