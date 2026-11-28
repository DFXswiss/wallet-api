import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionAccountService } from '../src/auth/session-account.service';
import { SessionGuard } from '../src/auth/session.guard';
import { BitcoinFamilyGuard } from '../src/bitcoin/bitcoin-family.guard';
import { BitcoinController } from '../src/bitcoin/bitcoin.controller';
import { BitcoinService } from '../src/bitcoin/bitcoin.service';
import { walletError } from '../src/common/wallet-error';
import { WalletExceptionFilter } from '../src/common/wallet-exception.filter';
import { WalletFamilies } from '../src/config/wallet-families';
import { walletCode } from './bitcoin-fixtures';
import { allFamiliesOff, allFamiliesOn, launchFamilies } from './wallet-families.fixtures';

const VALID_TOKEN = 'valid-session-token';
const FAMILY_DISABLED = { statusCode: 403, code: 'WalletFamilyDisabled', message: 'WalletFamilyDisabled' };
const BLOCKCHAINS = ['Bitcoin', 'BitcoinTestnet4', 'BitcoinRegtest'];

describe('BitcoinFamilyGuard', () => {
  it.each([
    ['all families on', allFamiliesOn()],
    ['the launch switches', launchFamilies()],
  ])('lets a request through with %s', (_case, families) => {
    expect(new BitcoinFamilyGuard(families).canActivate()).toBe(true);
  });

  it('refuses with 403 WalletFamilyDisabled while bitcoin is off', () => {
    expect(walletCode(() => new BitcoinFamilyGuard(allFamiliesOff()).canActivate())).toEqual({
      status: 403,
      code: 'WalletFamilyDisabled',
    });
  });

  it('refuses when only bitcoin is off', () => {
    const families = new WalletFamilies({ bitcoin: false, spark: true, evm: true });
    expect(walletCode(() => new BitcoinFamilyGuard(families).canActivate())).toEqual({
      status: 403,
      code: 'WalletFamilyDisabled',
    });
  });
});

// The /v1/wallet/bitcoin routes over HTTP, with the same global ValidationPipe and filter as src/main.ts.
// The order under test: family switch, session, body validation, service.
describe.each([
  ['on', allFamiliesOn()],
  ['off', allFamiliesOff()],
])('/v1/wallet/bitcoin/:blockchain with the bitcoin family %s', (state, families) => {
  const enabled = state === 'on';
  let app: INestApplication;
  let baseUrl: string;
  const accounts = {
    requireAccountId: jest.fn(async (token: string) => {
      if (token !== VALID_TOKEN) {
        throw walletError(401, 'SessionInvalid');
      }
      return 'account';
    }),
  };
  const service = {
    account: jest.fn(async () => ({})),
    fees: jest.fn(async (blockchain: string) => ({ blockchain })),
    prepare: jest.fn(async () => ({})),
    submit: jest.fn(async () => ({})),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BitcoinController],
      providers: [
        { provide: WalletFamilies, useValue: families },
        { provide: SessionAccountService, useValue: accounts },
        { provide: BitcoinService, useValue: service },
        SessionGuard,
        BitcoinFamilyGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new WalletExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // token null sends no Authorization header; omitting it sends the valid session token.
  function call(method: string, path: string, body?: unknown, token: string | null = VALID_TOKEN): Promise<Response> {
    const headers: Record<string, string> = {};
    if (token !== null) {
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    return fetch(`${baseUrl}/v1/wallet/bitcoin/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function expectNothingReached() {
    expect(accounts.requireAccountId).not.toHaveBeenCalled();
    expect(service.account).not.toHaveBeenCalled();
    expect(service.fees).not.toHaveBeenCalled();
    expect(service.prepare).not.toHaveBeenCalled();
    expect(service.submit).not.toHaveBeenCalled();
  }

  if (enabled) {
    it.each(BLOCKCHAINS)('answers GET %s/fees through the service with a session', async (blockchain) => {
      const response = await call('GET', `${blockchain}/fees`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ blockchain });
      expect(accounts.requireAccountId).toHaveBeenCalledWith(VALID_TOKEN);
      expect(service.fees).toHaveBeenCalledWith(blockchain);
    });

    it('answers 401 SessionRequired without a session', async () => {
      const response = await call('GET', 'BitcoinRegtest/fees', undefined, null);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        statusCode: 401,
        code: 'SessionRequired',
        message: 'SessionRequired',
      });
      expectNothingReached();
    });

    it('answers 401 SessionInvalid for an invalid session', async () => {
      const response = await call('POST', 'BitcoinRegtest/account', { addresses: [] }, 'not-a-session');
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: 'SessionInvalid' });
      expect(service.account).not.toHaveBeenCalled();
    });
  } else {
    it.each([
      ...BLOCKCHAINS.flatMap((blockchain): Array<[string, string, unknown]> => [
        ['POST', `${blockchain}/account`, { addresses: ['bcrt1qexample'] }],
        ['GET', `${blockchain}/fees`, undefined],
        ['POST', `${blockchain}/prepare`, { amount: 'max' }],
        ['POST', `${blockchain}/submit`, { prepareId: 'x' }],
      ]),
      ['GET', 'Litecoin/fees', undefined],
      ['POST', 'BitcoinRegtest/prepare', []],
    ])('refuses %s %s with 403 before the session check and any lookup', async (method, path, body) => {
      for (const token of [VALID_TOKEN, null, 'not-a-session']) {
        const response = await call(method, path, body, token);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual(FAMILY_DISABLED);
      }
      expectNothingReached();
    });
  }
});
