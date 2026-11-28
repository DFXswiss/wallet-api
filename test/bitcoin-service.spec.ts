import { Logger } from '@nestjs/common';
import * as btc from '@scure/btc-signer';
import { randomUUID } from 'node:crypto';
import {
  MAX_LIVE_PREPARES,
  PREPARE_RETENTION_MS,
  PREPARE_SWEEP_INTERVAL_MS,
  PREPARE_TTL_MS,
} from '../src/bitcoin/bitcoin-limits';
import { MAINNET_PARAMS } from '../src/bitcoin/bitcoin-network';
import { BitcoinPaymentStore, NewPreparedPayment } from '../src/bitcoin/bitcoin-payment.store';
import { BitcoinPrepareRequestDto } from '../src/bitcoin/bitcoin-prepare.dto';
import { mapLimit, parseAmount } from '../src/bitcoin/bitcoin.service';
import { FINAL_SEQUENCE, RBF_SEQUENCE, serializeWithoutWitness } from '../src/bitcoin/psbt-builder';
import { parseRawTransaction } from '../src/bitcoin/raw-transaction';
import { p2wpkh, txid, walletCode, walletCodeAsync } from './bitcoin-fixtures';
import {
  ACCOUNT,
  CHANGE,
  DESTINATION,
  FOREIGN,
  OTHER_ACCOUNT,
  RECEIVE,
  REGTEST_URL,
  Setup,
  confirmedAt,
  deviceSign,
  fundedRoutes,
  prepareDto,
  setup,
  signedHex,
  utxoRoute,
} from './bitcoin-service.fixtures';

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

  // The A38 runner failed the prd cases while ENVIRONMENT was set in its process environment: `new ConfigService()`
  // reads process.env before its own values. The fixture's configuration must not.
  it('ignores the ambient process environment', async () => {
    const saved = { ENVIRONMENT: process.env.ENVIRONMENT, ESPLORA_REGTEST_URL: process.env.ESPLORA_REGTEST_URL };
    process.env.ENVIRONMENT = 'dev';
    process.env.ESPLORA_REGTEST_URL = 'http://ambient-esplora.example:3000';
    try {
      const { service } = setup({ environment: 'prd' });
      expect(await walletCodeAsync(() => service.fees('BitcoinRegtest'))).toEqual({
        status: 404,
        code: 'EsploraNotConfigured',
      });
      expect(await walletCodeAsync(() => service.fees('BitcoinTestnet4'))).toEqual({
        status: 503,
        code: 'FeeEstimatesUnavailable',
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
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

  it('lists a zero-value UTXO next to a funded one instead of failing', async () => {
    const { service } = setup({
      routes: { ...routes, [`address/${RECEIVE}/utxo`]: [utxoRoute(39_800, '2', false, 1), utxoRoute(0, '3')] },
    });
    const view = await service.account('BitcoinRegtest', { addresses: [RECEIVE, CHANGE] });
    expect(view.utxos).toEqual([
      expect.objectContaining({ txid: txid('2'), vout: 1, value: 39_800 }),
      { txid: txid('3'), vout: 0, value: 0, address: RECEIVE, confirmed: true, height: 100, confirmations: 6 },
    ]);
    expect(view.balance.total).toBe(39_800);
  });

  it('marks the history incomplete when it is cut at the limit', async () => {
    const { service } = setup({ routes });
    const view = await service.account('BitcoinRegtest', { addresses: [RECEIVE], historyLimit: 1 });
    expect(view.history.map((entry) => entry.txid)).toEqual([txid('2')]);
    expect(view.historyComplete).toBe(false);
  });

  it('refuses a history limit outside 1 to 100 before any request', async () => {
    const { service, transport } = setup({ routes });
    for (const historyLimit of [0, 101, 1.5, -1]) {
      expect(
        await walletCodeAsync(() => service.account('BitcoinRegtest', { addresses: [RECEIVE], historyLimit })),
      ).toEqual({ status: 400, code: 'HistoryLimitInvalid' });
    }
    expect(transport.request).not.toHaveBeenCalled();
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
    for (const address of [p2wpkh(1, MAINNET_PARAMS), 'bcrt1qinvalid', 'x'.repeat(91), 'bcrt1q', 5 as any]) {
      expect(await walletCodeAsync(() => service.account('BitcoinRegtest', { addresses: [address] }))).toEqual({
        status: 400,
        code: 'AddressInvalid',
      });
    }
    for (const addresses of [[], new Array(51).fill(RECEIVE), 'not-an-array' as any]) {
      expect(await walletCodeAsync(() => service.account('BitcoinRegtest', { addresses }))).toEqual({
        status: 400,
        code: 'AddressInvalid',
      });
    }
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('merges duplicate addresses', async () => {
    const { service } = setup({ routes });
    const view = await service.account('BitcoinRegtest', { addresses: [RECEIVE, RECEIVE, RECEIVE.toUpperCase()] });
    expect(view.addresses.map((entry) => entry.address)).toEqual([RECEIVE]);
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

  it('counts a zero-value UTXO next to a funded one as uneconomical and spends only the funded one', async () => {
    const { service } = setup({
      routes: fundedRoutes({ [`address/${CHANGE}/utxo`]: [utxoRoute(0, 'b'), utxoRoute(0, 'c', false)] }),
    });
    const fixed = await service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ includeUnconfirmed: true }));
    expect(fixed).toMatchObject({
      amount: 40_000,
      totalInput: 100_000,
      uneconomicalUtxos: 2,
      inputs: [{ txid: txid('a'), vout: 0, value: 100_000, address: RECEIVE }],
    });
    const max = await service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ amount: 'max' }));
    expect(max).toMatchObject({
      totalInput: 100_000,
      uneconomicalUtxos: 1,
      inputs: [{ txid: txid('a'), vout: 0, value: 100_000, address: RECEIVE }],
    });
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
      prepareDto({ feeRateSatPerVb: undefined, feeRate: '__proto__' as any }),
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

  it('refuses a destination that is no address, also an oversized one', async () => {
    const { service } = setup({ routes: fundedRoutes() });
    for (const destination of ['short', '1'.repeat(91), 'bcrt1qinvalid']) {
      expect(
        await walletCodeAsync(() => service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ destination }))),
      ).toEqual({ status: 400, code: 'DestinationInvalid' });
    }
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
    const signed = deviceSign(
      payment.psbt,
      payment.inputs.map((input) => input.address),
      false,
    );
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

  it('answers 404 for a prepareId that is not a UUID before looking at the payload', async () => {
    const { service, store } = await prepared();
    store.sweeps = [];
    for (const prepareId of ['x', '', 42 as any]) {
      expect(
        await walletCodeAsync(() => service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId, transactionHex: 'zz' })),
      ).toEqual({ status: 404, code: 'PrepareNotFound' });
    }
    expect(store.sweeps).toEqual([]);
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

  it('deletes prepared payments past retention before the lookup, without any prepare', async () => {
    const { service, payment, store } = await prepared();
    const old = await service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ amount: '30000' }));
    const kept = await service.prepare(ACCOUNT, 'BitcoinRegtest', prepareDto({ amount: '20000' }));
    store.rows.get(old.prepareId).expiresAt = new Date(Date.now() - PREPARE_RETENTION_MS - 1);
    store.rows.get(kept.prepareId).expiresAt = new Date(Date.now() - PREPARE_RETENTION_MS + 60_000);
    store.sweeps = [];

    await service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex: signedHex(payment) });
    expect(store.sweeps).toHaveLength(1);
    expect(store.rows.has(old.prepareId)).toBe(false);
    expect(store.rows.has(kept.prepareId)).toBe(true);
    expect(store.rows.has(payment.prepareId)).toBe(true);

    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: old.prepareId, transactionHex: signedHex(old) }),
      ),
    ).toEqual({ status: 404, code: 'PrepareNotFound' });
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: kept.prepareId, transactionHex: signedHex(kept) }),
      ),
    ).toEqual({ status: 410, code: 'PrepareExpired' });
  });

  it('still submits when the retention sweep fails', async () => {
    const { service, payment, store } = await prepared();
    store.failSweep = true;
    const result = await service.submit(ACCOUNT, 'BitcoinRegtest', {
      prepareId: payment.prepareId,
      transactionHex: signedHex(payment),
    });
    expect(result).toEqual({ txid: payment.txid, prepareId: payment.prepareId, alreadySubmitted: false });
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

  it('refuses an oversized PSBT as TransactionInvalid', async () => {
    const { service, payment } = await prepared();
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, psbt: 'A'.repeat(1_200_004) }),
      ),
    ).toEqual({ status: 400, code: 'TransactionInvalid' });
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

  it.each<[string, number, (id: string) => string]>([
    ['an empty body', 200, () => ''],
    ['a whitespace body', 200, () => ' \n'],
    ['an HTML page', 200, () => '<html><body>OK</body></html>'],
    ['a JSON body with the txid', 200, (id) => JSON.stringify({ txid: id })],
    ['the txid in upper case', 200, (id) => id.toUpperCase()],
    ['the txid with a suffix', 200, (id) => `${id}ok`],
    ['another txid', 200, () => txid('f')],
    ['an empty 204', 204, () => ''],
  ])('answers 502 for a 2xx reply with %s and keeps the payment submittable', async (_case, status, body) => {
    let reply = (id: string) => ({ status, body: body(id) });
    const { service, payment, store, posts } = await prepared({
      post: (hex) => reply(parseRawTransaction(Buffer.from(hex, 'hex')).txid),
    });
    const transactionHex = signedHex(payment);
    expect(
      await walletCodeAsync(() =>
        service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex }),
      ),
    ).toEqual({ status: 502, code: 'OutboundRequestFailed' });
    expect(store.submitted).toEqual([]);
    expect(store.rows.get(payment.prepareId)?.submittedAt).toBeNull();

    reply = (id) => ({ status: 200, body: id });
    await expect(
      service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex }),
    ).resolves.toEqual({ txid: payment.txid, prepareId: payment.prepareId, alreadySubmitted: false });
    expect(posts).toHaveLength(2);
    expect(store.submitted).toEqual([payment.prepareId]);
  });

  it('accepts the expected txid with surrounding whitespace', async () => {
    const { service, payment } = await prepared({
      post: (hex) => ({ status: 200, body: `\n${parseRawTransaction(Buffer.from(hex, 'hex')).txid}\n` }),
    });
    await expect(
      service.submit(ACCOUNT, 'BitcoinRegtest', { prepareId: payment.prepareId, transactionHex: signedHex(payment) }),
    ).resolves.toEqual({ txid: payment.txid, prepareId: payment.prepareId, alreadySubmitted: false });
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

  it('sweeps rows past retention of every account on its own', async () => {
    const seen: { cutoff?: Date; sql?: string; executed: number } = { executed: 0 };
    const sweep = {
      delete: () => sweep,
      from: () => sweep,
      where: (sql: string, params: { cutoff: Date }) => {
        seen.sql = sql;
        seen.cutoff = params.cutoff;
        return sweep;
      },
      execute: async () => {
        seen.executed++;
        return { affected: 3 };
      },
    };
    const store = new BitcoinPaymentStore({ createQueryBuilder: () => sweep } as any, {} as any);
    const now = new Date();
    await store.sweepExpired(now);
    expect(seen.executed).toBe(1);
    expect(seen.sql).toBe('expires_at <= :cutoff');
    expect(now.getTime() - (seen.cutoff as Date).getTime()).toBe(PREPARE_RETENTION_MS);
  });

  it('runs the sweep every interval while the module runs, and logs a failed sweep', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const store = new BitcoinPaymentStore({} as any, {} as any);
      const sweep = jest.spyOn(store, 'sweepExpired').mockResolvedValue(undefined);
      store.onModuleInit();
      await jest.advanceTimersByTimeAsync(PREPARE_SWEEP_INTERVAL_MS - 1);
      expect(sweep).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(sweep).toHaveBeenCalledTimes(1);

      sweep.mockRejectedValueOnce(new Error('database unavailable'));
      await jest.advanceTimersByTimeAsync(PREPARE_SWEEP_INTERVAL_MS);
      expect(sweep).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);

      store.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(PREPARE_SWEEP_INTERVAL_MS * 3);
      expect(sweep).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
      jest.useRealTimers();
    }
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
