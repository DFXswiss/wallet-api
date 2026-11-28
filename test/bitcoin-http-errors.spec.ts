import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { SessionAccountService } from '../src/auth/session-account.service';
import { SessionGuard } from '../src/auth/session.guard';
import { BitcoinFamilyGuard } from '../src/bitcoin/bitcoin-family.guard';
import { BitcoinController } from '../src/bitcoin/bitcoin.controller';
import { BitcoinService } from '../src/bitcoin/bitcoin.service';
import { WalletExceptionFilter } from '../src/common/wallet-exception.filter';
import { WalletFamilies } from '../src/config/wallet-families';
import { ACCOUNT, CHANGE, DESTINATION, RECEIVE, fundedRoutes, setup, signedHex } from './bitcoin-service.fixtures';
import { allFamiliesOn } from './wallet-families.fixtures';

const VALID_TOKEN = 'valid-session-token';

const error = (statusCode: number, code: string) => ({ statusCode, code, message: code });

// The /v1/wallet/bitcoin routes over HTTP with the real BitcoinService (fake Esplora, in-memory store) and the same
// global ValidationPipe and filter as src/main.ts. The DTOs check only JSON type and presence, so the service's own
// checks produce the documented error codes.
describe('/v1/wallet/bitcoin/:blockchain error codes over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const context = setup({ routes: fundedRoutes() });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BitcoinController],
      providers: [
        { provide: WalletFamilies, useValue: allFamiliesOn() },
        { provide: SessionAccountService, useValue: { requireAccountId: async () => ACCOUNT } },
        { provide: BitcoinService, useValue: context.service },
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

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { authorization: `Bearer ${VALID_TOKEN}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${baseUrl}/v1/wallet/bitcoin/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  const prepareBody = (overrides: Record<string, unknown> = {}) => ({
    addresses: [RECEIVE, CHANGE],
    changeAddress: CHANGE,
    destination: DESTINATION,
    amount: '40000',
    feeRateSatPerVb: 2,
    ...overrides,
  });

  describe('POST account', () => {
    it.each<[string, unknown]>([
      ['no address', { addresses: [] }],
      ['51 addresses', { addresses: new Array(51).fill(RECEIVE) }],
      ['an address of the wrong length', { addresses: ['bcrt1q'] }],
      ['an address on another network', { addresses: ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'] }],
    ])('answers 400 AddressInvalid for %s', async (_case, body) => {
      await expect(call('POST', 'BitcoinRegtest/account', body)).resolves.toEqual({
        status: 400,
        body: error(400, 'AddressInvalid'),
      });
    });

    it.each([0, 101, 1.5])('answers 400 HistoryLimitInvalid for historyLimit %s', async (historyLimit) => {
      await expect(call('POST', 'BitcoinRegtest/account', { addresses: [RECEIVE], historyLimit })).resolves.toEqual({
        status: 400,
        body: error(400, 'HistoryLimitInvalid'),
      });
    });

    it.each<[string, unknown]>([
      ['a missing addresses field', {}],
      ['addresses that are no array', { addresses: RECEIVE }],
      ['a non-string address', { addresses: [42] }],
      ['a string historyLimit', { addresses: [RECEIVE], historyLimit: '5' }],
    ])('answers 400 BadRequest for %s', async (_case, body) => {
      const response = await call('POST', 'BitcoinRegtest/account', body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400, code: 'BadRequest' });
      expect(Array.isArray((response.body as { message: unknown }).message)).toBe(true);
    });
  });

  describe('GET fees', () => {
    it.each(['Litecoin', '__proto__'])('answers 404 EsploraNotConfigured for %s', async (blockchain) => {
      await expect(call('GET', `${blockchain}/fees`)).resolves.toEqual({
        status: 404,
        body: error(404, 'EsploraNotConfigured'),
      });
    });
  });

  describe('POST prepare', () => {
    it.each(['0', '01', '1.5', '-1', 'MAX', ''])('answers 400 AmountInvalid for amount "%s"', async (amount) => {
      await expect(call('POST', 'BitcoinRegtest/prepare', prepareBody({ amount }))).resolves.toEqual({
        status: 400,
        body: error(400, 'AmountInvalid'),
      });
    });

    it.each<[string, Record<string, unknown>]>([
      ['feeRate "instant"', { feeRateSatPerVb: undefined, feeRate: 'instant' }],
      ['feeRateSatPerVb 0', { feeRateSatPerVb: 0 }],
      ['feeRateSatPerVb 1001', { feeRateSatPerVb: 1001 }],
      ['feeRateSatPerVb 1.5', { feeRateSatPerVb: 1.5 }],
      ['both fee fields', { feeRate: 'fast' }],
      ['no fee field', { feeRateSatPerVb: undefined }],
    ])('answers 400 FeeRateChoiceInvalid for %s', async (_case, overrides) => {
      await expect(call('POST', 'BitcoinRegtest/prepare', prepareBody(overrides))).resolves.toEqual({
        status: 400,
        body: error(400, 'FeeRateChoiceInvalid'),
      });
    });

    it('answers 400 AddressInvalid for an empty address list', async () => {
      await expect(call('POST', 'BitcoinRegtest/prepare', prepareBody({ addresses: [] }))).resolves.toEqual({
        status: 400,
        body: error(400, 'AddressInvalid'),
      });
    });

    it('answers 400 DestinationInvalid for an oversized destination', async () => {
      await expect(
        call('POST', 'BitcoinRegtest/prepare', prepareBody({ destination: 'b'.repeat(200) })),
      ).resolves.toEqual({ status: 400, body: error(400, 'DestinationInvalid') });
    });

    it('answers 400 BadRequest for a numeric amount', async () => {
      const response = await call('POST', 'BitcoinRegtest/prepare', prepareBody({ amount: 40000 }));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400, code: 'BadRequest' });
    });
  });

  describe('POST submit', () => {
    it.each(['x', 'not-a-uuid', `${randomUUID()}0`])('answers 404 PrepareNotFound for prepareId "%s"', async (id) => {
      await expect(call('POST', 'BitcoinRegtest/submit', { prepareId: id, transactionHex: '00' })).resolves.toEqual({
        status: 404,
        body: error(404, 'PrepareNotFound'),
      });
    });

    it('answers 400 SubmitPayloadInvalid without transactionHex and psbt', async () => {
      await expect(call('POST', 'BitcoinRegtest/submit', { prepareId: randomUUID() })).resolves.toEqual({
        status: 400,
        body: error(400, 'SubmitPayloadInvalid'),
      });
    });

    it('answers 400 TransactionInvalid for a transactionHex that is not hex', async () => {
      await expect(
        call('POST', 'BitcoinRegtest/submit', { prepareId: randomUUID(), transactionHex: 'zz' }),
      ).resolves.toEqual({ status: 400, body: error(400, 'TransactionInvalid') });
    });

    it('prepares and submits end to end, and refuses a 2xx broadcast reply without the txid with 502', async () => {
      const prepared = await call('POST', 'BitcoinRegtest/prepare', prepareBody());
      expect(prepared.status).toBe(201);
      const payment = prepared.body as { prepareId: string; txid: string; psbt: string; inputs: { address: string }[] };
      const transactionHex = signedHex(payment);

      context.transport.request.mockImplementationOnce(async () => ({
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('<html>OK</html>'),
      }));
      await expect(
        call('POST', 'BitcoinRegtest/submit', { prepareId: payment.prepareId, transactionHex }),
      ).resolves.toEqual({ status: 502, body: error(502, 'OutboundRequestFailed') });

      await expect(
        call('POST', 'BitcoinRegtest/submit', { prepareId: payment.prepareId, transactionHex }),
      ).resolves.toEqual({
        status: 200,
        body: { txid: payment.txid, prepareId: payment.prepareId, alreadySubmitted: false },
      });
    });
  });
});
