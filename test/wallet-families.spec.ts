import { HttpException, INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressesService } from '../src/addresses/addresses.service';
import { WalletExceptionFilter } from '../src/common/wallet-exception.filter';
import { WalletConfigModule, createWalletFamilies } from '../src/config/config.module';
import { WALLET_ENVIRONMENTS, readWalletRuntimeConfig, validateEnvironment } from '../src/config/environment';
import { ENVIRONMENT_CONFIGS } from '../src/config/environments';
import { PrdEnvironment } from '../src/config/environments/prd';
import {
  WALLET_FAMILIES,
  WalletFamilies,
  chainFamily,
  parseWalletFamilySwitches,
  readWalletFamilies,
} from '../src/config/wallet-families';
import { EnsService } from '../src/ens/ens.service';
import { LnurlService } from '../src/lnurl/lnurl.service';
import { HTTP_TRANSPORT } from '../src/outbound/http-transport';
import { ProxyModule } from '../src/proxy/proxy.module';
import { ProxyService } from '../src/proxy/proxy.service';
import { WalletDataService } from '../src/wallet/wallet-data.service';
import { allFamiliesOff, allFamiliesOn, launchFamilies } from './wallet-families.fixtures';

const BASE_ENV = {
  DATABASE_URL: 'postgres://wallet:wallet@127.0.0.1:5432/wallet',
  WALLET_SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
};

const LAUNCH = { bitcoin: true, spark: false, evm: false };

async function refusal(operation: Promise<unknown> | (() => unknown)): Promise<HttpException> {
  try {
    await (typeof operation === 'function' ? operation() : operation);
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the operation to be refused');
}

async function expectFamilyDisabled(operation: Promise<unknown> | (() => unknown)): Promise<void> {
  const error = await refusal(operation);
  expect(error.getStatus()).toBe(403);
  expect(error.getResponse()).toEqual({
    statusCode: 403,
    code: 'WalletFamilyDisabled',
    message: 'WalletFamilyDisabled',
  });
}

function proxyWith(families: WalletFamilies) {
  const transport = {
    request: jest.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"result":"0x1"}'),
    })),
  };
  const config = new ConfigService({
    ESPLORA_BASE_URLS: JSON.stringify({ bitcoin: 'https://esplora.example.com' }),
    EVM_RPC_URLS: JSON.stringify({ '1': 'https://rpc.example.com' }),
  });
  return { service: new ProxyService(config, transport as any, families), transport };
}

function addressesWith(families: WalletFamilies) {
  const rows = [
    { chain: 'bitcoin', address: 'bc1qexample' },
    { chain: 'ethereum', address: '0x1111111111111111111111111111111111111111' },
    { chain: 'spark', address: 'sp1example' },
  ];
  const repository = {
    findOneBy: jest.fn(async () => null),
    find: jest.fn(async () => rows),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) =>
      work({ create: (_entity: unknown, value: unknown) => value, save: async (value: unknown) => value }),
    ),
  };
  return { service: new AddressesService(repository as any, dataSource as any, families), repository, dataSource };
}

describe('wallet family configuration', () => {
  it.each(WALLET_ENVIRONMENTS)('starts %s with Bitcoin on and Spark and EVM off', (environment) => {
    expect(ENVIRONMENT_CONFIGS[environment].walletFamilies).toEqual(LAUNCH);
    expect(readWalletFamilies(environment)).toEqual(LAUNCH);
  });

  it.each(WALLET_ENVIRONMENTS)('lists exactly the known families in %s', (environment) => {
    expect(Object.keys(ENVIRONMENT_CONFIGS[environment].walletFamilies).sort()).toEqual([...WALLET_FAMILIES].sort());
  });

  it.each(WALLET_ENVIRONMENTS)('reads the switches of %s at boot', (environment) => {
    expect(readWalletRuntimeConfig({ ...BASE_ENV, ENVIRONMENT: environment }).walletFamilies).toEqual(LAUNCH);
  });

  it('maps every address chain to its family', () => {
    expect(chainFamily('bitcoin')).toBe('bitcoin');
    expect(chainFamily('spark')).toBe('spark');
    expect(chainFamily('ethereum')).toBe('evm');
  });

  it.each([
    ['a missing family', { bitcoin: true, spark: false }],
    ['a string instead of a boolean', { bitcoin: 'true', spark: false, evm: false }],
    ['a number instead of a boolean', { bitcoin: 1, spark: false, evm: false }],
    ['an undefined value', { bitcoin: true, spark: undefined, evm: false }],
    ['an unknown family', { bitcoin: true, spark: false, evm: false, lightning: true }],
    ['an inherited key only', Object.create({ bitcoin: true, spark: false, evm: false })],
    ['an array', [true, false, false]],
    ['null', null],
  ])('refuses %s', (_case, value) => {
    expect(() => parseWalletFamilySwitches(value, 'test')).toThrow();
  });

  it('stops boot when an environment file misses a switch', () => {
    const switches = PrdEnvironment.walletFamilies as Record<string, boolean>;
    const spark = switches.spark;
    delete switches.spark;
    try {
      expect(() => readWalletRuntimeConfig({ ...BASE_ENV, ENVIRONMENT: 'prd' })).toThrow(
        'src/config/environments/prd.ts: walletFamilies.spark must be true or false',
      );
      expect(() => validateEnvironment({ ...BASE_ENV, ENVIRONMENT: 'prd' })).toThrow(
        'walletFamilies.spark must be true or false',
      );
    } finally {
      switches.spark = spark;
    }
    expect(readWalletFamilies('prd')).toEqual(LAUNCH);
  });

  it.each([undefined, '', 'staging', 'PRD', '__proto__'])('refuses ENVIRONMENT %p instead of a default', (value) => {
    expect(() => createWalletFamilies({ get: () => value } as unknown as ConfigService)).toThrow(
      'ENVIRONMENT must be one of prd, stg, dev, or loc',
    );
    expect(() => validateEnvironment({ ...BASE_ENV, ENVIRONMENT: value })).toThrow();
  });

  it('keeps the switches of the running process unchanged', () => {
    const families = launchFamilies();
    const response = families.toResponse();
    response.families.evm = true;
    expect(families.isEnabled('evm')).toBe(false);
    expect(families.toResponse()).toEqual({ families: LAUNCH });
  });
});

describe('wallet families in the launch configuration', () => {
  const families = launchFamilies();

  it('returns every family with its switch', () => {
    expect(families.toResponse()).toEqual({ families: { bitcoin: true, spark: false, evm: false } });
  });

  it('refuses EVM JSON-RPC before any upstream request', async () => {
    const { service, transport } = proxyWith(families);
    await expectFamilyDisabled(service.evmRpc('1', { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }));
    await expectFamilyDisabled(service.evmRpc('137', { method: 'debug_traceTransaction' }));
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('serves the Bitcoin Esplora proxy', async () => {
    const { service, transport } = proxyWith(families);
    await expect(service.esploraGet('bitcoin', 'blocks/tip/height')).resolves.toMatchObject({ status: 200 });
    await expect(service.esploraPostTransaction('bitcoin', Buffer.from('00'))).resolves.toMatchObject({ status: 200 });
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it('refuses ENS lookups before the RPC check and any upstream request', async () => {
    const proxy = { ethereumRpc: undefined, ethereumEthCall: jest.fn(), evmRpc: jest.fn() };
    const service = new EnsService(proxy as never, families);
    await expectFamilyDisabled(service.address('alice.eth'));
    await expectFamilyDisabled(service.name('0x1111111111111111111111111111111111111111'));
    expect(proxy.ethereumEthCall).not.toHaveBeenCalled();
    expect(proxy.evmRpc).not.toHaveBeenCalled();
  });

  it('refuses LNURL and Lightning-address lookups before any outbound request', async () => {
    const safeFetch = { fetchJson: jest.fn() };
    const service = new LnurlService(safeFetch as any, families);
    await expectFamilyDisabled(service.resolve('https://pay.example.com/lnurlp/alice'));
    await expectFamilyDisabled(service.resolve(undefined));
    await expectFamilyDisabled(service.lightningAddress('alice@pay.example.com'));
    expect(safeFetch.fetchJson).not.toHaveBeenCalled();
  });

  it.each(['spark', 'ethereum'] as const)('refuses storing a %s address before any database access', async (chain) => {
    const { service, repository, dataSource } = addressesWith(families);
    await expectFamilyDisabled(service.upsert('account', { chain, address: 'x' }));
    expect(repository.findOneBy).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('stores a Bitcoin address', async () => {
    const { service } = addressesWith(families);
    await expect(service.upsert('account', { chain: 'bitcoin', address: 'bc1qexample' })).resolves.toEqual({
      chain: 'bitcoin',
      address: 'bc1qexample',
    });
  });

  it('lists only the addresses of families that are on', async () => {
    const { service } = addressesWith(families);
    await expect(service.list('account')).resolves.toEqual([{ chain: 'bitcoin', address: 'bc1qexample' }]);
  });

  it('lists only the chains of families that are on', async () => {
    await expect(new WalletDataService(families).chains()).resolves.toEqual([
      { id: 'bitcoin', name: 'Bitcoin', family: 'bitcoin' },
    ]);
  });
});

describe('wallet families with every family on', () => {
  const families = allFamiliesOn();

  it('returns every family as on', () => {
    expect(families.toResponse()).toEqual({ families: { bitcoin: true, spark: true, evm: true } });
  });

  it('forwards EVM JSON-RPC', async () => {
    const { service, transport } = proxyWith(families);
    await expect(service.evmRpc('1', { jsonrpc: '2.0', id: 1, method: 'eth_chainId' })).resolves.toEqual({
      result: '0x1',
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('reaches the ENS configuration check', async () => {
    const service = new EnsService({ ethereumRpc: undefined } as never, families);
    const error = await refusal(service.address('alice.eth'));
    expect(error.getResponse()).toMatchObject({ code: 'EnsNotConfigured' });
  });

  it('forwards a Lightning-address lookup', async () => {
    const safeFetch = { fetchJson: jest.fn(async () => ({ tag: 'payRequest' })) };
    const service = new LnurlService(safeFetch as any, families);
    await expect(service.lightningAddress('alice@pay.example.com')).resolves.toEqual({ tag: 'payRequest' });
    expect(safeFetch.fetchJson).toHaveBeenCalledWith('https://pay.example.com/.well-known/lnurlp/alice', {
      allowedContentTypes: ['application/json'],
    });
  });

  it.each(['spark', 'ethereum'] as const)('stores a %s address', async (chain) => {
    const { service } = addressesWith(families);
    await expect(service.upsert('account', { chain, address: 'x' })).resolves.toEqual({ chain, address: 'x' });
  });

  it('lists every stored address', async () => {
    const { service } = addressesWith(families);
    await expect(service.list('account')).resolves.toHaveLength(3);
  });

  it('lists every chain', async () => {
    const chains = await new WalletDataService(families).chains();
    expect(chains.map((chain) => (chain as { id: string }).id)).toEqual(['bitcoin', 'ethereum', 'spark']);
  });
});

describe('wallet families with Bitcoin off', () => {
  const families = allFamiliesOff();

  it('refuses the Esplora proxy before any upstream request', async () => {
    const { service, transport } = proxyWith(families);
    await expectFamilyDisabled(service.esploraGet('bitcoin', 'blocks/tip/height'));
    await expectFamilyDisabled(service.esploraPostTransaction('bitcoin', Buffer.from('00')));
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('refuses storing a Bitcoin address', async () => {
    const { service, repository } = addressesWith(families);
    await expectFamilyDisabled(service.upsert('account', { chain: 'bitcoin', address: 'bc1qexample' }));
    expect(repository.findOneBy).not.toHaveBeenCalled();
  });

  it('lists no address and no chain', async () => {
    const { service } = addressesWith(families);
    await expect(service.list('account')).resolves.toEqual([]);
    await expect(new WalletDataService(families).chains()).resolves.toEqual([]);
  });
});

describe('GET /v1/wallet/config', () => {
  let app: INestApplication;
  let baseUrl: string;
  const transport = { request: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ ENVIRONMENT: 'loc' })] }),
        WalletConfigModule,
        ProxyModule,
      ],
    })
      .overrideProvider(HTTP_TRANSPORT)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new WalletExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the families without a session', async () => {
    const response = await fetch(`${baseUrl}/v1/wallet/config`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ families: { bitcoin: true, spark: false, evm: false } });
  });

  it('refuses the EVM JSON-RPC route with 403 WalletFamilyDisabled', async () => {
    const response = await fetch(`${baseUrl}/v1/wallet/evm/1/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId' }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      statusCode: 403,
      code: 'WalletFamilyDisabled',
      message: 'WalletFamilyDisabled',
    });
    expect(transport.request).not.toHaveBeenCalled();
  });
});
