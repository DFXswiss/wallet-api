import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressFamilyGuard } from '../src/addresses/address-family.guard';
import { AddressesController } from '../src/addresses/addresses.controller';
import { AddressesService } from '../src/addresses/addresses.service';
import { SessionAccountService } from '../src/auth/session-account.service';
import { SessionGuard } from '../src/auth/session.guard';
import { walletError } from '../src/common/wallet-error';
import { WalletExceptionFilter } from '../src/common/wallet-exception.filter';
import { WalletFamilies } from '../src/config/wallet-families';
import { launchFamilies } from './wallet-families.fixtures';

const VALID_TOKEN = 'valid-session-token';

const FAMILY_DISABLED = { statusCode: 403, code: 'WalletFamilyDisabled', message: 'WalletFamilyDisabled' };

// PUT /v1/wallet/addresses over HTTP, with the launch switches (Bitcoin on, Spark and EVM off) and the same global
// ValidationPipe and filter as src/main.ts. The order under test: session, family switch, body validation.
describe('PUT /v1/wallet/addresses family refusal', () => {
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
  const repository = { findOneBy: jest.fn(async () => null), find: jest.fn(async () => []) };
  const dataSource = {
    transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) =>
      work({ create: (_entity: unknown, value: unknown) => value, save: async (value: unknown) => value }),
    ),
  };

  beforeAll(async () => {
    const families = launchFamilies();
    const moduleRef = await Test.createTestingModule({
      controllers: [AddressesController],
      providers: [
        { provide: WalletFamilies, useValue: families },
        { provide: SessionAccountService, useValue: accounts },
        { provide: AddressesService, useValue: new AddressesService(repository as any, dataSource as any, families) },
        SessionGuard,
        AddressFamilyGuard,
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

  function put(body: unknown, token: string | undefined = VALID_TOKEN): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    return fetch(`${baseUrl}/v1/wallet/addresses`, { method: 'PUT', headers, body: JSON.stringify(body) });
  }

  it.each([
    ['spark', { chain: 'spark' }],
    ['spark', { chain: 'spark', address: '' }],
    ['ethereum', { chain: 'ethereum', address: 42 }],
  ])('refuses a disabled %s chain with an invalid body with 403 before validation', async (_chain, body) => {
    const response = await put(body);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(FAMILY_DISABLED);
    expect(accounts.requireAccountId).toHaveBeenCalledTimes(1);
    expect(repository.findOneBy).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses a disabled chain with a valid body with 403 before any database access', async () => {
    const response = await put({ chain: 'ethereum', address: '0x1111111111111111111111111111111111111111' });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(FAMILY_DISABLED);
    expect(repository.findOneBy).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('answers 400 for an enabled chain with an invalid body', async () => {
    const response = await put({ chain: 'bitcoin' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ statusCode: 400, code: 'BadRequest' });
    expect(repository.findOneBy).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing chain', { address: 'x' }],
    ['an unknown chain', { chain: 'lightning', address: 'x' }],
    ['an inherited key as chain', { chain: '__proto__', address: 'x' }],
  ])('leaves %s to the validation with 400', async (_case, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ statusCode: 400, code: 'BadRequest' });
  });

  it('answers 401 without a session, before the family check', async () => {
    const response = await put({ chain: 'spark' }, undefined);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      statusCode: 401,
      code: 'SessionRequired',
      message: 'SessionRequired',
    });
    expect(accounts.requireAccountId).not.toHaveBeenCalled();
  });

  it('answers 401 for an invalid session, before the family check', async () => {
    const response = await put({ chain: 'spark' }, 'not-a-session');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'SessionInvalid' });
  });

  it('stores an address of an enabled chain', async () => {
    const response = await put({ chain: 'bitcoin', address: 'bc1qexample' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ chain: 'bitcoin', address: 'bc1qexample' });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});
