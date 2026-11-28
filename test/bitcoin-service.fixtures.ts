import * as btc from '@scure/btc-signer';
import { randomUUID } from 'node:crypto';
import { PREPARE_RETENTION_MS } from '../src/bitcoin/bitcoin-limits';
import { REGTEST_PARAMS } from '../src/bitcoin/bitcoin-network';
import { BitcoinPaymentStore, NewPreparedPayment } from '../src/bitcoin/bitcoin-payment.store';
import { BitcoinPrepareRequestDto } from '../src/bitcoin/bitcoin-prepare.dto';
import { BitcoinService } from '../src/bitcoin/bitcoin.service';
import { parseRawTransaction } from '../src/bitcoin/raw-transaction';
import { OutboundRequest } from '../src/outbound/http-transport';
import { ProxyService } from '../src/proxy/proxy.service';
import { isolatedConfig, p2wpkh, privateKey, txid } from './bitcoin-fixtures';
import { allFamiliesOn } from './wallet-families.fixtures';

export const REGTEST_URL = 'http://regtest-esplora.example:3000';
export const ACCOUNT = '00000000-0000-4000-8000-000000000001';
export const OTHER_ACCOUNT = '00000000-0000-4000-8000-000000000002';

export const RECEIVE = p2wpkh(1, REGTEST_PARAMS);
export const CHANGE = p2wpkh(2, REGTEST_PARAMS);
export const DESTINATION = p2wpkh(3, REGTEST_PARAMS);
export const FOREIGN = p2wpkh(9, REGTEST_PARAMS);

export const confirmedAt = (height: number) => ({ confirmed: true, block_height: height, block_time: 1_700_000_000 });

export type StoredRow = NewPreparedPayment & { id: string; submittedAt: Date | null; createdAt: Date };

/** In-memory BitcoinPaymentStore with the same retention rule as the real one. */
export class MemoryStore {
  readonly rows = new Map<string, StoredRow>();
  submitted: string[] = [];
  sweeps: Date[] = [];
  failSweep = false;

  async create(payment: NewPreparedPayment, now: Date): Promise<StoredRow> {
    await this.sweepExpired(now);
    const row = { ...payment, id: randomUUID(), submittedAt: null, createdAt: now };
    this.rows.set(row.id, row);
    return row;
  }

  async sweepExpired(now: Date): Promise<void> {
    this.sweeps.push(now);
    if (this.failSweep) {
      throw new Error('database unavailable');
    }
    const cutoff = now.getTime() - PREPARE_RETENTION_MS;
    for (const [id, row] of this.rows) {
      if (row.expiresAt.getTime() <= cutoff) {
        this.rows.delete(id);
      }
    }
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

export type Setup = {
  environment?: string;
  routes?: Record<string, unknown>;
  post?: (hex: string) => { status: number; body: string };
};

/**
 * A BitcoinService with a fake Esplora transport and an in-memory store. The configuration comes only from the
 * values below (never from process.env), so the test runner's environment cannot change the result.
 */
export function setup(options: Setup = {}) {
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
  const config = isolatedConfig({
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

export function utxoRoute(value: number, byte: string, confirmed = true, vout = 0) {
  return { txid: txid(byte), vout, value, status: confirmed ? confirmedAt(100) : { confirmed: false } };
}

export function fundedRoutes(extra: Record<string, unknown> = {}) {
  return {
    [`address/${RECEIVE}/utxo`]: [utxoRoute(100_000, 'a')],
    [`address/${CHANGE}/utxo`]: [],
    ...extra,
  };
}

export function prepareDto(overrides: Partial<BitcoinPrepareRequestDto> = {}): BitcoinPrepareRequestDto {
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
export function deviceSign(psbt: string, inputAddresses: string[], finalize = true): btc.Transaction {
  const keys: Record<string, Uint8Array> = { [RECEIVE]: privateKey(1), [CHANGE]: privateKey(2) };
  const tx = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(psbt, 'base64')));
  inputAddresses.forEach((address, index) => tx.signIdx(keys[address], index));
  if (finalize) {
    tx.finalize();
  }
  return tx;
}

export function signedHex(prepared: { psbt: string; inputs: { address: string }[] }): string {
  const tx = deviceSign(
    prepared.psbt,
    prepared.inputs.map((input) => input.address),
  );
  return Buffer.from(tx.extract()).toString('hex');
}
