import { ConfigService } from '@nestjs/config';
import * as btc from '@scure/btc-signer';
import { randomUUID } from 'node:crypto';
import { MAX_LIVE_PREPARES, PREPARE_RETENTION_MS, PREPARE_TTL_MS } from '../src/bitcoin/bitcoin-limits';
import { REGTEST_PARAMS, MAINNET_PARAMS } from '../src/bitcoin/bitcoin-network';
import { BitcoinPaymentStore, NewPreparedPayment } from '../src/bitcoin/bitcoin-payment.store';
import { BitcoinPrepareRequestDto } from '../src/bitcoin/bitcoin-prepare.dto';
import { BitcoinService, mapLimit, parseAmount } from '../src/bitcoin/bitcoin.service';
import { FINAL_SEQUENCE, RBF_SEQUENCE, serializeWithoutWitness } from '../src/bitcoin/psbt-builder';
import { parseRawTransaction } from '../src/bitcoin/raw-transaction';
import { OutboundRequest } from '../src/outbound/http-transport';
import { ProxyService } from '../src/proxy/proxy.service';
import { p2wpkh, privateKey, txid, walletCode, walletCodeAsync } from './bitcoin-fixtures';
import { allFamiliesOn } from './wallet-families.fixtures';

const REGTEST_URL = 'http://regtest-esplora.example:3000';
const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT = '00000000-0000-4000-8000-000000000002';

const RECEIVE = p2wpkh(1, REGTEST_PARAMS);
const CHANGE = p2wpkh(2, REGTEST_PARAMS);
const DESTINATION = p2wpkh(3, REGTEST_PARAMS);
const FOREIGN = p2wpkh(9, REGTEST_PARAMS);

const confirmedAt = (height: number) => ({ confirmed: true, block_height: height, block_time: 1_700_000_000 });

type StoredRow = NewPreparedPayment & { id: string; submittedAt: Date | null; createdAt: Date };

class MemoryStore {
  readonly rows = new Map<string, StoredRow>();
  submitted: string[] = [];

  async create(payment: NewPreparedPayment, now: Date): Promise<StoredRow> {
    const row = { ...payment, id: randomUUID(), submittedAt: null, createdAt: now };
    this.rows.set(row.id, row);
    return row;
  }

  async find(id: string, walletAccountId: string, blockchain: string): Promise<StoredRow | null> {
    const row = this.rows.get(id);
    return row && row.walletAccountId === walletAccountId && row.blockchain === blockchain ? row : null;
  }

  async markSubmitted(id: string, now: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row && !row.submittedAt) {
      row.submittedAt = now;
      this.submitted.push(id);
    }
  }
}

type Setup = {
  environment?: string;
  routes?: Record<string, unknown>;
  post?: (hex: string) => { status: number; body: string };
};

function setup(options: Setup = {}) {
  const routes: Record<string, unknown> = { 'fee-estimates': {}, 'blocks/tip/height': 105, ...options.routes };
  const posts: string[] = [];
  const transport = {
    request: jest.fn(async (request: OutboundRequest) => {
      const path = new URL(request.url).pathname.slice(1);
      if (request.method === 'POST') {
        const hex = Buffer.from(request.body as Uint8Array).toString('utf8');
        posts.push(hex);
        const answer = options.post
          ? options.post(hex)
          : { status: 200, body: parseRawTransaction(Buffer.from(hex, 'hex')).txid };
        return { status: answer.status, headers: { 'content-type': 'text/plain' }, body: Buffer.from(answer.body) };
      }
      if (!Object.hasOwn(routes, path)) {
        return { status: 404, headers: {}, body: Buffer.from('not found') };
      }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(routes[path])),
      };
    }),
  };
  const config = new ConfigService({
    ENVIRONMENT: options.environment ?? 'stg',
    ESPLORA_REGTEST_URL: REGTEST_URL,
    ESPLORA_BASE_URLS: JSON.stringify({
      Bitcoin: 'https://esplora.example.com',
      BitcoinTestnet4: 'https://testnet4-esplora.example.com',
    }),
  });
  const proxy = new ProxyService(config, transport as any, allFamiliesOn());
  const store = new MemoryStore();
  const service = new BitcoinService(config, proxy, store as unknown as BitcoinPaymentStore);
  return { service, transport, store, posts, routes };
}

function utxoRoute(value: number, byte: string, confirmed = true, vout = 0) {
  return { txid: txid(byte), vout, value, status: confirmed ? confirmedAt(100) : { confirmed: false } };
}

function fundedRoutes(extra: Record<string, unknown> = {}) {
  return {
    [`address/${RECEIVE}/utxo`]: [utxoRoute(100_000, 'a')],
    [`address/${CHANGE}/utxo`]: [],
    ...extra,
  };
}

function prepareDto(overrides: Partial<BitcoinPrepareRequestDto> = {}): BitcoinPrepareRequestDto {
  return {
    addresses: [RECEIVE, CHANGE],
    changeAddress: CHANGE,
    destination: DESTINATION,
    amount: '40000',
    feeRateSatPerVb: 2,
    ...overrides,
  };
}

/** What the device does: sign each input with the key of the address the response names. */
function deviceSign(psbt: string, inputAddresses: string[], finalize = true): btc.Transaction {
  const keys: Record<string, Uint8Array> = { [RECEIVE]: privateKey(1), [CHANGE]: privateKey(2) };
  const tx = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(psbt, 'base64')));
  inputAddresses.forEach((address, index) => tx.signIdx(keys[address], index));
  if (finalize) {
    tx.finalize();
  }
  return tx;
}

function signedHex(prepared: { psbt: string; inputs: { address: string }[] }): string {
  const tx = deviceSign(prepared.psbt, prepared.inputs.map((input) => input.address));
  return Buffer.from(tx.extract()).toString('hex');
}

describe('bitcoin routes resolve the blockchain like the proxy', () => {
  it.each(['Litecoin', 'toString', '__proto__', 'bitcoin'])('answers 404 for %s', async (blockchain) => {
    const { service, transport } = setup();
    expect(await walletCodeAsync(() => service.fees(blockchain))).toEqual({
      status: 404,
      code: 'EsploraNotConfigured',
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('answers 404 for BitcoinRegtest on prd', async () => {
    const { service, transport } = setup({ environment: 'prd' });
    expect(await walletCodeAsync(() => service.fees('BitcoinRegtest'))).toEqual({
      status: 404,
      code: 'EsploraNotConfigured',
    });
    expect(await walletCodeAsync(() => service.account('BitcoinRegtest', { addresses: [RECEIVE] }))).toEqual({
      status: 404,
      code: 'EsploraNotConfigured',
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('uses the regtest origin from ESPLORA_REGTEST_URL', async () => {
    const { service, transport } = setup({ routes: { 'fee-estimates': { '1': 2 } } });
    await service.fees('BitcoinRegtest');
    expect(transport.request).toHaveBeenCalledWith(expect.objectContaining({ url: `${REGTEST_URL}/fee-estimates` }));
  });
});

describe('fees', () => {
  it('maps Esplora estimates', async () => {
    const { service } = setup({ routes: { 'fee-estimates': { '1': 12.3, '6': 5, '144': 1.01 } } });
    await expect(service.fees('BitcoinRegtest')).resolves.toEqual({
      blockchain: 'BitcoinRegtest',
      source: 'esplora',
      unit: 'sat/vB',
      rates: { fast: 13, normal: 5, slow: 1 },
    });
  });

  it.each(['stg', 'dev', 'loc'])('falls back on %s for regtest and testnet4 without an estimate', async (env) => {
    const { service } = setup({ environment: env });
    await expect(service.fees('BitcoinRegtest')).resolves.toMatchObject({
      source: 'fallback',
      rates: { fast: 3, normal: 2, slow: 1 },
    });
    await expect(service.fees('BitcoinTestnet4')).resolves.toMatchObject({
      source: 'fallback',
      rates: { fast: 3, normal: 2, slow: 1 },
    });
  });

  it.each(['prd', 'stg', 'dev', 'loc'])('fails loud for mainnet without an estimate on %s', async (env) => {
    const { service } = setup({ environment: env });
    expect(await walletCodeAsync(() => service.fees('Bitcoin'))).toEqual({
      status: 503,
      code: 'FeeEstimatesUnavailable',
    });
  });

  it('fails loud for testnet4 without an estimate on prd', async () => {
    const { service } = setup({ environment: 'prd' });
    expect(await walletCodeAsync(() => service.fees('BitcoinTestnet4'))).toEqual({
      status: 503,
      code: 'FeeEstimatesUnavailable',
    });
  });

  it('maps an upstream failure to 502', async () => {
    const { service, routes } = setup();
    delete routes['fee-estimates'];
    expect(await walletCodeAsync(() => service.fees('BitcoinRegtest'))).toEqual({
      status: 502,
      code: 'OutboundRequestFailed',
    });
  });
});

describe('account view', () => {
  const incoming = {
    txid: txid('1'),
    vin: [{ txid: txid('0'), vout: 0, is_coinbase: false, prevout: { scriptpubkey_address: FOREIGN, value: 200_000 } }],
    vout: [
      { scriptpubkey_address: RECEIVE, value: 100_000 },
      { scriptpubkey_address: FOREIGN, value: 99_000 },
    ],
    fee: 1_000,
    status: confirmedAt(100),
  };
  const outgoing = {
    txid: txid('2'),
    vin: [{ txid: txid('1'), vout: 0, is_coinbase: false, prevout: { scriptpubkey_address: RECEIVE, value: 100_000 } }],
    vout: [
      { scriptpubkey_address: FOREIGN, value: 60_000 },
      { scriptpubkey_address: RECEIVE, value: 39_800 },
    ],
    fee: 200,
    status: { confirmed: false },
  };
  const stats = (chain: number[], mempool: number[]) => ({
    address: 'ignored',
    chain_stats: {
      funded_txo_count: 0,
      funded_txo_sum: chain[0],
      spent_txo_count: 0,
      spent_txo_sum: chain[1],
      tx_count: chain[2],
    },
    mempool_stats: {
      funded_txo_count: 0,
      funded_txo_sum: mempool[0],
      spent_txo_count: 0,
      spent_txo_sum: mempool[1],
      tx_count: mempool[2],
    },
  });
  const routes = {
    [`address/${RECEIVE}`]: stats([100_000, 0, 1], [39_800, 100_000, 1]),
    [`address/${RECEIVE}/utxo`]: [utxoRoute(39_800, '2', false, 1)],
    [`address/${RECEIVE}/txs`]: [outgoing, incoming],
    [`address/${CHANGE}`]: stats([0, 0, 0], [0, 0, 0]),
  };

  it('returns balances, UTXOs, history, and which addresses are used', async () => {
    const { service, transport } = setup({ routes });
    const view = await service.account('BitcoinRegtest', { addresses: [RECEIVE, CHANGE.toUpperCase()] });
    expect(view.balance).toEqual({ confirmed: 100_000, unconfirmed: -60_200, total: 39_800 });
    expect(view.tipHeight).toBe(105);
    expect(view.addresses).toEqual([
      { address: RECEIVE, confirmed: 100_000, unconfirmed: -60_200, total: 39_800, txCount: 2, used: true },
      { address: CHANGE, confirmed: 0, unconfirmed: 0, total: 0, txCount: 0, used: false },
    ]);
    expect(view.utxos).toEqual([
      {
        txid: txid('2'),
        vout: 1,
        value: 39_800,
        address: RECEIVE,
        confirmed: false,
        height: null,
        confirmations: 0,
      },
    ]);
    expect(view.history).toEqual([
      {
        txid: txid('2'),
        confirmed: false,
        height: null,
        time: null,
        confirmations: 0,
        netAmount: -60_200,
        fee: 200,
        direction: 'outgoing',
      },
      {
        txid: txid('1'),
        confirmed: true,
        height: 100,
        time: 1_700_000_000,
        confirmations: 6,
        netAmount: 100_000,
        fee: 1_000,
        direction: 'incoming',
      },
    ]);
    expect(view.historyComplete).toBe(true);
    expect(view.historyLimit).toBe(50);
    // An unused address costs one upstream request; a used one three; plus the tip height.
    expect(transport.request).toHaveBeenCalledTimes(5);
  });

  it('marks the history incomplete when it is cut at the limit', async () => {
    const { service } = setup({ routes });
    const view = await service.account('BitcoinRegtest', { addresses: [RECEIVE], historyLimit: 1 });
    expect(view.history.map((entry) => entry.txid)).toEqual([txid('2')]);
    expect(view.historyComplete).toBe(false);
  });

  it('marks the history incomplete when an address has more than one Esplora page', async () => {
    const { service } = setup({
      routes: { ...routes, [`address/${RECEIVE}`]: stats([100_000, 0, 30], [39_800, 100_000, 1]) },
    });
    expect((await service.account('BitcoinRegtest', { addresses: [RECEIVE] })).historyComplete).toBe(false);
  });

  it('marks a transaction between wallet addresses as self', async () => {
    const self = {
      ...outgoing,
      vout: [
        { scriptpubkey_address: CHANGE, value: 60_000 },
        { scriptpubkey_address: RECEIVE, value: 39_800 },
      ],
    };
    const { service } = setup({
      routes: {
        ...routes,
        [`address/${RECEIVE}/txs`]: [self],
        [`address/${RECEIVE}`]: stats([100_000, 0, 0], [39_800, 100_000, 1]),
      },
    });
    const view = await service.account('BitcoinRegtest', { addresses: [RECEIVE, CHANGE] });
    expect(view.history[0]).toMatchObject({ direction: 'self', netAmount: -200 });
  });

  it('refuses addresses of another network or type before any request', async () => {
    const { service, transport } = setup({ routes });
    for (const address of [p2wpkh(1, MAINNET_PARAMS), 'bcrt1qinvalid']) {
      expect(await walletCodeAsync(() => service.account('BitcoinRegtest', { addresses: [address] }))).toEqual({
        status: 400,
        code: 'AddressInvalid',
      });
    }
    expect(await walletCodeAsync(() => service.account('BitcoinRegtest', { addresses: [] }))).toEqual({
      status: 400,
      code: 'AddressInvalid',
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('maps a malformed upstream answer to 502', async () => {
    const { service } = setup({ routes: { ...routes, [`address/${RECEIVE}`]: { chain_stats: {} } } });
    expect(await walletCodeAsync(() => service.account('BitcoinRegtest', { addresses: [RECEIVE] }))).toEqual({
      status: 502,
      code: 'OutboundRequestFailed',
    });
  });
});

describe('prepare', () => {
  it('builds an unsigned PSBT with change and stores the prepared payment', async () => {
    const { service, store } = setup({ routes: fundedRoutes() });
    const before = Date.now();
    const prepared = await service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto());
    expect(prepared).toMatchObject({
      blockchain: 'BitcoinRegtest',
      destination: DESTINATION,
      amount: 40_000,
      fee: 282,
      feeRate: 2,
      change: 59_718,
      changeAddress: CHANGE,
      changeAddedToFee: 0,
      vsize: 141,
      rbf: true,
      totalInput: 100_000,
      inputs: [{ txid: txid('a'), vout: 0, value: 100_000, address: RECEIVE }],
    });
    expect(prepared.outputs).toHaveLength(2);
    expect(prepared.outputs).toEqual(
      expect.arrayContaining([
        { address: DESTINATION, value: 40_000, kind: 'destination' },
        { address: CHANGE, value: 59_718, kind: 'change' },
      ]),
    );
    expect(new Date(prepared.expiresAt).getTime() - before).toBeGreaterThanOrEqual(PREPARE_TTL_MS - 1_000);

    const psbt = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(prepared.psbt, 'base64')));
    expect(psbt.inputsLength).toBe(1);
    expect(psbt.getInput(0).sequence).toBe(RBF_SEQUENCE);
    expect(psbt.getInput(0).witnessUtxo?.amount).toBe(100_000n);
    const outputAmounts = prepared.outputs.map((_, index) => psbt.getOutput(index).amount);
    expect(outputAmounts).toEqual(prepared.outputs.map((output) => BigInt(output.value)));

    const row = store.rows.get(prepared.prepareId);
    expect(row).toMatchObject({
      walletAccountId: ACCOUNT,
      blockchain: 'BitcoinRegtest',
      txid: prepared.txid,
      amount: '40000',
      fee: '282',
      feeRate: 2,
      submittedAt: null,
    });
  });

  it('sends the maximum without change and without RBF', async () => {
    const { service } = setup({
      routes: fundedRoutes({ [`address/${CHANGE}/utxo`]: [utxoRoute(50_000, 'b')] }),
    });
    const prepared = await service.prepare(
      ACCOUNT,
      'BitcoinRegtest',
      prepareDto({ amount: 'max', feeRateSatPerVb: 1, rbf: false }),
    );
    expect(prepared).toMatchObject({ amount: 149_822, fee: 178, change: 0, changeAddress: null, rbf: false });
    expect(prepared.outputs).toEqual([{ address: DESTINATION, value: 149_822, kind: 'destination' }]);
    const psbt = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(prepared.psbt, 'base64')));
    expect(psbt.getInput(0).sequence).toBe(FINAL_SEQUENCE);
    expect(psbt.getInput(1).sequence).toBe(FINAL_SEQUENCE);
  });

  it('uses the chosen fee rate preset', async () => {
    const { service } = setup({ routes: fundedRoutes() });
    const prepared = await service.prepare(
      ACCOUNT,
      'BitcoinRegtest',
      prepareDto({ feeRateSatPerVb: undefined, feeRate: 'fast' }),
    );
    expect(prepared.feeRate).toBe(3);
    expect(prepared.fee).toBe(141 * 3);
  });

  it('requires exactly one fee rate choice', async () => {
    const { service } = setup({ routes: fundedRoutes() });
    for (const dto of [
      prepareDto({ feeRate: 'normal' }),
      prepareDto({ feeRateSatPerVb: undefined }),
      prepareDto({ feeRateSatPerVb: 0 }),
      prepareDto({ feeRateSatPerVb: 1.5 }),
      prepareDto({ feeRateSatPerVb: 1001 }),
      prepareDto({ feeRateSatPerVb: undefined, feeRate: 'instant' as any }),
    ]) {
      expect(await walletCodeAsync(() => service.prepare(ACCOUNT, 'BitcoinRegtest', dto))).toEqual({
        status: 400,
        code: 'FeeRateChoiceInvalid',
      });
    }
  });

  it('refuses the wallet’s own addresses as destination unless allowed', async () => {
    const { service } = setup({ routes: fundedRoutes() });
    for (const destination of [CHANGE, RECEIVE, RECEIVE.toUpperCase()]) {
      const dto = prepareDto({ destination });
      expect(await walletCodeAsync(() => service.prepare(ACCOUNT, 'BitcoinRegtest', dto))).toEqual({
        status: 422,
        code: 'DestinationIsOwnAddress',
      });
    }
    const allowed = await service.prepare(
      ACCOUNT,
      'BitcoinRegtest',
      prepareDto({ destination: CHANGE, allowOwnDestination: true }),
    );
    expect(allowed.destination).toBe(CHANGE);
  });

  it('refuses a destination on another network', async () => {
    const { service, transport } = setup({ routes: fundedRoutes() });
    expect(
      await walletCodeAsync(() =>
        service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ destination: p2wpkh(3, MAINNET_PARAMS) })),
      ),
    ).toEqual({ status: 400, code: 'DestinationWrongNetwork' });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('refuses a change address that is not P2WPKH on the network', async () => {
    const { service } = setup({ routes: fundedRoutes() });
    expect(
      await walletCodeAsync(() =>
        service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ changeAddress: p2wpkh(2, MAINNET_PARAMS) })),
      ),
    ).toEqual({ status: 400, code: 'AddressInvalid' });
  });

  it('spends unconfirmed UTXOs only when asked', async () => {
    const { service } = setup({
      routes: fundedRoutes({ [`address/${RECEIVE}/utxo`]: [utxoRoute(100_000, 'a', false)] }),
    });
    expect(await walletCodeAsync(() => service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto()))).toEqual({
      status: 422,
      code: 'InsufficientFunds',
    });
    const prepared = await service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ includeUnconfirmed: true }));
    expect(prepared.inputs).toHaveLength(1);
  });

  it('refuses insufficient funds, dust, and a fee above the amount', async () => {
    const { service } = setup({ routes: fundedRoutes() });
    const code = (dto: BitcoinPrepareRequestDto) =>
      walletCodeAsync(() => service.prepare(ACCOUNT, 'BitcoinRegtest', dto));
    expect(await code(prepareDto({ amount: '100000' }))).toEqual({ status: 422, code: 'InsufficientFunds' });
    expect(await code(prepareDto({ amount: '293' }))).toEqual({ status: 422, code: 'AmountBelowDust' });
    expect(await code(prepareDto({ amount: '300', feeRateSatPerVb: 5 }))).toEqual({
      status: 422,
      code: 'FeeExceedsAmount',
    });
  });

  it('parses amounts as integer sats', () => {
    expect(parseAmount('max')).toBe('max');
    expect(parseAmount('1')).toBe(1);
    expect(parseAmount('2100000000000000')).toBe(2_100_000_000_000_000);
    for (const raw of ['0', '01', '1.5', '-1', '1e3', '2100000000000001', 'MAX', ' 1', '', 5 as any]) {
      expect(walletCode(() => parseAmount(raw))).toEqual({ status: 400, code: 'AmountInvalid' });
    }
  });
});

describe('submit', () => {
  async function prepared(options: Setup = {}) {
    const context = setup({ routes: fundedRoutes(), ...options });
    const payment = await context.service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto());
    return { ...context, payment };
  }

  it('broadcasts the signed transaction once and answers a repeat with the same txid', async () => {
    const { service, payment, posts, store } = await prepared();
    const transactionHex = signedHex(payment);
    const first = await service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex });
    expect(first).toEqual({ txid: payment.txid, prepareId: payment.prepareId, alreadySubmitted: false });
    expect(posts).toEqual([transactionHex]);
    expect(store.submitted).toEqual([payment.prepareId]);

    const repeat = await service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex });
    expect(repeat).toEqual({ txid: payment.txid, prepareId: payment.prepareId, alreadySubmitted: true });
    expect(posts).toHaveLength(1);
  });

  it('accepts a signed PSBT and finalizes it', async () => {
    const { service, payment, posts } = await prepared();
    const signed = deviceSign(payment.psbt, payment.inputs.map((input) => input.address), false);
    const psbt = Buffer.from(signed.toPSBT()).toString('base64');
    const result = await service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, psbt });
    expect(result.txid).toBe(payment.txid);
    expect(parseRawTransaction(Buffer.from(posts[0], 'hex')).txid).toBe(payment.txid);
  });

  it('refuses a transaction that differs from the prepared one', async () => {
    const { service, payment, posts } = await prepared();
    const other = await service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ amount: '30000' }));
    const transactionHex = signedHex(other);
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex }),
      ),
    ).toEqual({ status: 422, code: 'TransactionMismatch' });
    expect(posts).toHaveLength(0);
  });

  it('refuses another account, another blockchain, and an unknown id', async () => {
    const { service, payment } = await prepared();
    const transactionHex = signedHex(payment);
    const cases: Array<[string, string, string]> = [
      [OTHER_ACCOUNT, 'BitcoinRegtest', payment.prepareId],
      [ACCOUNT, 'BitcoinTestnet4', payment.prepareId],
      [ACCOUNT, 'BitcoinRegtest', randomUUID()],
      [ACCOUNT, 'BitcoinRegtest', 'not-a-uuid'],
    ];
    for (const [account, blockchain, prepareId] of cases) {
      expect(await walletCodeAsync(() => service.submit(account, blockchain, { prepareId, transactionHex }))).toEqual({
        status: 404,
        code: 'PrepareNotFound',
      });
    }
  });

  it('refuses an expired prepared payment', async () => {
    const { service, payment, store, posts } = await prepared();
    store.rows.get(payment.prepareId).expiresAt = new Date(Date.now() - 1);
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex: signedHex(payment) }),
      ),
    ).toEqual({ status: 410, code: 'PrepareExpired' });
    expect(posts).toHaveLength(0);
  });

  it('refuses an unsigned transaction', async () => {
    const { service, payment, posts } = await prepared();
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, psbt: payment.psbt }),
      ),
    ).toEqual({ status: 400, code: 'TransactionNotSigned' });
    const psbt = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(payment.psbt, 'base64')));
    const inputs = [{ txid: txid('a'), vout: 0, value: 100_000, script: new Uint8Array(0) }];
    const outputs = Array.from({ length: psbt.outputsLength }, (_, index) => {
      const output = psbt.getOutput(index);
      return { value: Number(output.amount), script: output.script as Uint8Array };
    });
    const unsignedHex = serializeWithoutWitness(inputs, outputs, RBF_SEQUENCE).toString('hex');
    expect(parseRawTransaction(Buffer.from(unsignedHex, 'hex')).txid).toBe(payment.txid);
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex: unsignedHex }),
      ),
    ).toEqual({ status: 400, code: 'TransactionNotSigned' });
    expect(posts).toHaveLength(0);
  });

  it('requires exactly one of transactionHex and psbt', async () => {
    const { service, payment } = await prepared();
    const transactionHex = signedHex(payment);
    for (const dto of [
      { prepareId: payment.prepareId },
      { prepareId: payment.prepareId, transactionHex, psbt: payment.psbt },
    ]) {
      expect(await walletCodeAsync(() => service.submit(ACCOUNT, 'BitcoinRegtest', dto))).toEqual({
        status: 400,
        code: 'SubmitPayloadInvalid',
      });
    }
  });

  it.each([
    'sendrawtransaction RPC error: {"code":-27,"message":"Transaction already in block chain"}',
    'sendrawtransaction RPC error: {"code":-26,"message":"txn-already-in-mempool"}',
    'sendrawtransaction RPC error: {"code":-27,"message":"Transaction outputs already in utxo set"}',
  ])('treats an upstream "already known" answer as submitted: %s', async (message) => {
    const { service, payment, store } = await prepared({ post: () => ({ status: 400, body: message }) });
    const result = await service.submit(ACCOUNT, 'BitcoinRegtest', {
      prepareId: payment.prepareId,
      transactionHex: signedHex(payment),
    });
    expect(result).toEqual({ txid: payment.txid, prepareId: payment.prepareId, alreadySubmitted: true });
    expect(store.submitted).toEqual([payment.prepareId]);
  });

  it('answers 422 when the node rejects the transaction and keeps it submittable', async () => {
    const rejection = 'sendrawtransaction RPC error: {"code":-25,"message":"bad-txns-inputs-missingorspent"}';
    const { service, payment, store } = await prepared({ post: () => ({ status: 400, body: rejection }) });
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex: signedHex(payment) }),
      ),
    ).toEqual({ status: 422, code: 'BroadcastRejected' });
    expect(store.submitted).toEqual([]);
  });

  it('answers 502 on an upstream server error', async () => {
    const { service, payment, store } = await prepared({ post: () => ({ status: 503, body: 'unavailable' }) });
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex: signedHex(payment) }),
      ),
    ).toEqual({ status: 502, code: 'OutboundRequestFailed' });
    expect(store.submitted).toEqual([]);
  });
});

describe('prepared payment store', () => {
  function fakeDataSource(live: number, events: string[], seen: { cutoff?: Date; lockParams?: unknown[] }) {
    const payments = {
      createQueryBuilder: (alias?: string) => {
        if (alias) {
          events.push('count');
          const query = { where: () => query, andWhere: () => query, getCount: async () => live };
          return query;
        }
        events.push('sweep');
        const sweep = {
          delete: () => sweep,
          from: () => sweep,
          where: (_sql: string, params: { cutoff: Date }) => {
            seen.cutoff = params.cutoff;
            return sweep;
          },
          execute: async () => ({ affected: 0 }),
        };
        return sweep;
      },
      create: (data: unknown) => data,
      save: async (data: unknown) => {
        events.push('save');
        return data;
      },
    };
    return {
      transaction: async (run: (manager: unknown) => Promise<unknown>) =>
        run({
          query: async (sql: string, params: unknown[]) => {
            expect(sql).toContain('pg_advisory_xact_lock');
            seen.lockParams = params;
            events.push('lock');
          },
          withRepository: () => payments,
        }),
    };
  }

  const payment: NewPreparedPayment = {
    walletAccountId: ACCOUNT,
    blockchain: 'BitcoinRegtest',
    txid: txid('a'),
    psbt: 'cHNidP8=',
    inputs: [],
    outputs: [],
    amount: '1000',
    fee: '141',
    feeRate: 1,
    expiresAt: new Date(),
  };

  it('locks per account, sweeps old rows, and refuses at the cap', async () => {
    const events: string[] = [];
    const seen: { cutoff?: Date; lockParams?: unknown[] } = {};
    const store = new BitcoinPaymentStore({} as any, fakeDataSource(MAX_LIVE_PREPARES, events, seen) as any);
    const now = new Date();
    expect(await walletCodeAsync(() => store.create(payment, now))).toEqual({
      status: 429,
      code: 'PrepareRateLimited',
    });
    expect(events).toEqual(['lock', 'sweep', 'count']);
    expect(seen.lockParams?.[1]).toBe(ACCOUNT);
    expect(now.getTime() - (seen.cutoff as Date).getTime()).toBe(PREPARE_RETENTION_MS);
  });

  it('stores below the cap', async () => {
    const events: string[] = [];
    const store = new BitcoinPaymentStore({} as any, fakeDataSource(MAX_LIVE_PREPARES - 1, events, {}) as any);
    await expect(store.create(payment, new Date())).resolves.toMatchObject({ txid: txid('a'), submittedAt: null });
    expect(events).toEqual(['lock', 'sweep', 'count', 'save']);
  });
});

describe('mapLimit', () => {
  it('keeps order and the concurrency bound', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (value) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return value * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
