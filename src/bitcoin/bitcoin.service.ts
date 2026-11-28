import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { walletError } from '../common/wallet-error';
import { BitcoinPreparedInput, BitcoinPreparedOutput } from '../entities/bitcoin-prepared-payment.entity';
import { ProxyService } from '../proxy/proxy.service';
import {
  AccountView,
  AddressData,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  buildAccountView,
  parseAddressStats,
  parseTipHeight,
  parseTransactions,
  parseUtxos,
} from './account-view';
import { BitcoinAccountRequestDto } from './bitcoin-account.dto';
import { BitcoinFeesResponseDto } from './bitcoin-fees.dto';
import { ESPLORA_CONCURRENCY, MAX_WALLET_ADDRESSES, PREPARE_TTL_MS } from './bitcoin-limits';
import {
  BitcoinNetwork,
  DUST_THRESHOLD,
  DecodedAddress,
  bitcoinNetwork,
  decodeDestination,
  decodeWalletAddress,
} from './bitcoin-network';
import { BitcoinPaymentStore } from './bitcoin-payment.store';
import { AMOUNT_PATTERN, BitcoinPrepareRequestDto, BitcoinPrepareResponseDto } from './bitcoin-prepare.dto';
import { BitcoinSubmitRequestDto, BitcoinSubmitResponseDto } from './bitcoin-submit.dto';
import { MAX_MONEY_SATS, SelectableUtxo, selectCoins } from './coin-selection';
import {
  FEE_RATE_CHOICES,
  FeeRates,
  MAX_FEE_RATE_SAT_PER_VB,
  feeRatesFromEstimates,
  parseFeeEstimates,
} from './fee-estimates';
import { FINAL_SEQUENCE, RBF_SEQUENCE, buildUnsignedPayment } from './psbt-builder';
import {
  extractFromPsbt,
  isSignedP2wpkh,
  outpointKey,
  parseRawTransaction,
  parseTransactionHex,
} from './raw-transaction';

/** Node answers for a transaction it already has, in the mempool or in a block. */
const ALREADY_KNOWN =
  /txn-already-in-mempool|txn-already-known|already in (the )?block ?chain|outputs already in utxo set/i;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await run(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** `max`, or an integer number of sats from 1 to 21 million BTC. Throws 400 `AmountInvalid`. */
export function parseAmount(raw: unknown): number | 'max' {
  if (typeof raw !== 'string' || !AMOUNT_PATTERN.test(raw)) {
    throw walletError(400, 'AmountInvalid');
  }
  if (raw === 'max') {
    return 'max';
  }
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_MONEY_SATS) {
    throw walletError(400, 'AmountInvalid');
  }
  return amount;
}

@Injectable()
export class BitcoinService {
  constructor(
    private readonly config: ConfigService,
    private readonly proxy: ProxyService,
    private readonly store: BitcoinPaymentStore,
  ) {}

  async account(blockchain: string, dto: BitcoinAccountRequestDto): Promise<AccountView> {
    const network = this.network(blockchain);
    const addresses = this.walletAddresses(network, dto.addresses).map((decoded) => decoded.address);
    const historyLimit = dto.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_HISTORY_LIMIT) {
      throw walletError(400, 'HistoryLimitInvalid');
    }
    const tipHeight = parseTipHeight(await this.esploraJson(blockchain, 'blocks/tip/height'));
    const data = await mapLimit(addresses, ESPLORA_CONCURRENCY, async (address): Promise<AddressData> => {
      const stats = parseAddressStats(await this.esploraJson(blockchain, `address/${address}`));
      if (stats.chainTxCount + stats.mempoolTxCount === 0) {
        return { address, stats, utxos: [], transactions: [] };
      }
      const utxos = parseUtxos(await this.esploraJson(blockchain, `address/${address}/utxo`));
      const transactions = parseTransactions(await this.esploraJson(blockchain, `address/${address}/txs`));
      return { address, stats, utxos, transactions };
    });
    return buildAccountView(blockchain, tipHeight, data, historyLimit);
  }

  async fees(blockchain: string): Promise<BitcoinFeesResponseDto> {
    const network = this.network(blockchain);
    const { rates, source } = await this.feeRates(network);
    return { blockchain, source, unit: 'sat/vB', rates };
  }

  async prepare(
    walletAccountId: string,
    blockchain: string,
    dto: BitcoinPrepareRequestDto,
  ): Promise<BitcoinPrepareResponseDto> {
    const network = this.network(blockchain);
    const wallet = this.walletAddresses(network, dto.addresses);
    const change = decodeWalletAddress(network, dto.changeAddress);
    const destination = decodeDestination(network, dto.destination);
    const own = new Set([...wallet.map((decoded) => decoded.address), change.address]);
    if (own.has(destination.address) && dto.allowOwnDestination !== true) {
      throw walletError(422, 'DestinationIsOwnAddress');
    }
    const amount = parseAmount(dto.amount);
    const feeRate = await this.resolveFeeRate(network, dto);
    const rbf = dto.rbf !== false;
    const includeUnconfirmed = dto.includeUnconfirmed === true;

    const scripts = new Map(wallet.map((decoded) => [decoded.address, decoded.script]));
    const lists = await mapLimit(wallet, ESPLORA_CONCURRENCY, async ({ address }) =>
      parseUtxos(await this.esploraJson(blockchain, `address/${address}/utxo`)).map((utxo): SelectableUtxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        address,
        confirmed: utxo.confirmed,
      })),
    );
    const unique = new Map<string, SelectableUtxo>();
    lists.flat().forEach((utxo) => unique.set(`${utxo.txid}:${utxo.vout}`, utxo));
    const utxos = [...unique.values()].filter((utxo) => includeUnconfirmed || utxo.confirmed);

    const selection = selectCoins({
      utxos,
      amount,
      feeRate,
      destinationScriptLength: destination.script.length,
      destinationDust: DUST_THRESHOLD[destination.type],
    });

    const outputs: Array<BitcoinPreparedOutput & { script: Uint8Array }> = [
      { address: destination.address, value: selection.amount, kind: 'destination', script: destination.script },
    ];
    if (selection.change > 0) {
      const changeOutput = {
        address: change.address,
        value: selection.change,
        kind: 'change' as const,
        script: change.script,
      };
      // The change position is random so that it does not mark which output is the payment.
      if (randomInt(2) === 0) {
        outputs.unshift(changeOutput);
      } else {
        outputs.push(changeOutput);
      }
    }
    const sequence = rbf ? RBF_SEQUENCE : FINAL_SEQUENCE;
    const unsigned = buildUnsignedPayment(
      selection.inputs.map((input) => ({
        txid: input.txid,
        vout: input.vout,
        value: input.value,
        script: scripts.get(input.address) as Uint8Array,
      })),
      outputs.map((output) => ({ value: output.value, script: output.script })),
      sequence,
    );

    const inputs: BitcoinPreparedInput[] = selection.inputs.map(({ txid, vout, value, address }) => ({
      txid,
      vout,
      value,
      address,
    }));
    const storedOutputs: BitcoinPreparedOutput[] = outputs.map(({ address, value, kind }) => ({
      address,
      value,
      kind,
    }));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PREPARE_TTL_MS);
    const record = await this.store.create(
      {
        walletAccountId,
        blockchain,
        txid: unsigned.txid,
        psbt: unsigned.psbt,
        inputs,
        outputs: storedOutputs,
        amount: String(selection.amount),
        fee: String(selection.fee),
        feeRate,
        expiresAt,
      },
      now,
    );

    return {
      prepareId: record.id,
      expiresAt: expiresAt.toISOString(),
      blockchain,
      psbt: unsigned.psbt,
      txid: unsigned.txid,
      destination: destination.address,
      amount: selection.amount,
      fee: selection.fee,
      feeRate,
      change: selection.change,
      changeAddress: selection.change > 0 ? change.address : null,
      changeAddedToFee: selection.changeAddedToFee,
      vsize: selection.vsize,
      rbf,
      totalInput: selection.totalInput,
      uneconomicalUtxos: selection.uneconomicalUtxos,
      inputs,
      outputs: storedOutputs,
    };
  }

  async submit(
    walletAccountId: string,
    blockchain: string,
    dto: BitcoinSubmitRequestDto,
  ): Promise<BitcoinSubmitResponseDto> {
    const network = this.network(blockchain);
    // A prepareId that is not a UUID can never name a prepared payment.
    if (typeof dto.prepareId !== 'string' || !UUID_PATTERN.test(dto.prepareId)) {
      throw walletError(404, 'PrepareNotFound');
    }
    const hasHex = dto.transactionHex !== undefined && dto.transactionHex !== null;
    const hasPsbt = dto.psbt !== undefined && dto.psbt !== null;
    if (hasHex === hasPsbt) {
      throw walletError(400, 'SubmitPayloadInvalid');
    }
    const raw = hasHex ? parseTransactionHex(dto.transactionHex) : extractFromPsbt(dto.psbt);
    const tx = parseRawTransaction(raw);
    await this.sweepExpired();
    const record = await this.store.find(dto.prepareId, walletAccountId, blockchain);
    if (!record) {
      throw walletError(404, 'PrepareNotFound');
    }
    if (tx.txid !== record.txid) {
      throw walletError(422, 'TransactionMismatch');
    }
    // The txid commits to no witness data, so an unsigned or badly signed body has the prepared txid too. The
    // signature shape is checked before the idempotent answer: only a fully signed spend of the prepared inputs is
    // ever confirmed as submitted.
    const prevoutScripts = new Map(
      record.inputs.map((input) => [
        outpointKey(input.txid, input.vout),
        decodeWalletAddress(network, input.address).script,
      ]),
    );
    if (!isSignedP2wpkh(tx, prevoutScripts)) {
      throw walletError(400, 'TransactionNotSigned');
    }
    if (record.submittedAt) {
      return { txid: record.txid, prepareId: record.id, alreadySubmitted: true };
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw walletError(410, 'PrepareExpired');
    }
    const alreadyKnown = await this.broadcast(blockchain, raw, record.txid);
    await this.store.markSubmitted(record.id, new Date());
    return { txid: record.txid, prepareId: record.id, alreadySubmitted: alreadyKnown };
  }

  /**
   * Deletes prepared payments past their retention before a submit looks one up. Best effort: the store's hourly
   * sweep retries, and a failed delete must not block a payment.
   */
  private async sweepExpired(): Promise<void> {
    try {
      await this.store.sweepExpired(new Date());
    } catch {
      // Ignored on purpose, see above.
    }
  }

  /**
   * Returns true when the node already had the transaction. A 2xx answer counts as broadcast only when its body is
   * exactly the expected txid; any other 2xx body (empty, HTML, JSON, another txid) answers 502
   * `OutboundRequestFailed`, and the prepared payment stays submittable.
   */
  private async broadcast(blockchain: string, raw: Buffer, txid: string): Promise<boolean> {
    const response = await this.proxy.esploraPostTransaction(blockchain, Buffer.from(raw.toString('hex'), 'utf8'));
    const text = Buffer.from(response.body).toString('utf8').trim();
    if (response.status >= 200 && response.status < 300) {
      if (!/^[0-9a-f]{64}$/.test(text) || text !== txid) {
        throw walletError(502, 'OutboundRequestFailed');
      }
      return false;
    }
    if (ALREADY_KNOWN.test(text)) {
      return true;
    }
    if (response.status >= 400 && response.status < 500) {
      throw walletError(422, 'BroadcastRejected');
    }
    throw walletError(502, 'OutboundRequestFailed');
  }

  private get environment(): string | undefined {
    return this.config.get<string>('ENVIRONMENT');
  }

  /** Unknown ids and ids without an Esplora upstream (always `BitcoinRegtest` on prd) answer 404. */
  private network(blockchain: string): BitcoinNetwork {
    const network = bitcoinNetwork(blockchain);
    if (!network || !this.proxy.esploraBase(blockchain)) {
      throw walletError(404, 'EsploraNotConfigured');
    }
    return network;
  }

  private walletAddresses(network: BitcoinNetwork, raw: unknown): DecodedAddress[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_WALLET_ADDRESSES) {
      throw walletError(400, 'AddressInvalid');
    }
    const decoded = new Map<string, DecodedAddress>();
    for (const address of raw) {
      const entry = decodeWalletAddress(network, address);
      decoded.set(entry.address, entry);
    }
    return [...decoded.values()];
  }

  private async feeRates(network: BitcoinNetwork): Promise<{ rates: FeeRates; source: 'esplora' | 'fallback' }> {
    const estimates = parseFeeEstimates(await this.esploraJson(network.blockchain, 'fee-estimates'));
    const rates = feeRatesFromEstimates(estimates);
    if (rates) {
      return { rates, source: 'esplora' };
    }
    if (network.feeFallback && this.environment !== undefined && this.environment !== 'prd') {
      return { rates: { ...network.feeFallback }, source: 'fallback' };
    }
    throw walletError(503, 'FeeEstimatesUnavailable');
  }

  private async resolveFeeRate(network: BitcoinNetwork, dto: BitcoinPrepareRequestDto): Promise<number> {
    const hasChoice = dto.feeRate !== undefined && dto.feeRate !== null;
    const hasExplicit = dto.feeRateSatPerVb !== undefined && dto.feeRateSatPerVb !== null;
    if (hasChoice === hasExplicit) {
      throw walletError(400, 'FeeRateChoiceInvalid');
    }
    if (hasExplicit) {
      const rate = dto.feeRateSatPerVb;
      if (!Number.isSafeInteger(rate) || rate < 1 || rate > MAX_FEE_RATE_SAT_PER_VB) {
        throw walletError(400, 'FeeRateChoiceInvalid');
      }
      return rate;
    }
    if (!FEE_RATE_CHOICES.includes(dto.feeRate)) {
      throw walletError(400, 'FeeRateChoiceInvalid');
    }
    const { rates } = await this.feeRates(network);
    return rates[dto.feeRate];
  }

  private async esploraJson(blockchain: string, path: string): Promise<unknown> {
    const response = await this.proxy.esploraGet(blockchain, path);
    if (response.status !== 200) {
      throw walletError(502, 'OutboundRequestFailed');
    }
    try {
      return JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown;
    } catch {
      throw walletError(502, 'OutboundRequestFailed');
    }
  }
}
