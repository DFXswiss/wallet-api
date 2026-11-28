import { walletError } from '../common/wallet-error';

/** Esplora returns the first 25 confirmed transactions (plus up to 50 unconfirmed ones) per address page. */
export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 100;

export type AddressStats = {
  /** Confirmed balance in sats. */
  confirmed: number;
  /** Unconfirmed change in sats; negative while a spend is in the mempool. */
  unconfirmed: number;
  chainTxCount: number;
  mempoolTxCount: number;
};

export type EsploraUtxo = {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  height: number | null;
};

export type EsploraTxEnd = {
  address: string | null;
  value: number;
};

export type EsploraTx = {
  txid: string;
  confirmed: boolean;
  height: number | null;
  time: number | null;
  fee: number;
  inputs: EsploraTxEnd[];
  outputs: EsploraTxEnd[];
};

function malformed(): never {
  throw walletError(502, 'OutboundRequestFailed');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    malformed();
  }
  return value as Record<string, unknown>;
}

function sats(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    malformed();
  }
  return value;
}

function txid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    malformed();
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return sats(value);
}

function status(value: unknown): { confirmed: boolean; height: number | null; time: number | null } {
  const parsed = record(value);
  if (typeof parsed.confirmed !== 'boolean') {
    malformed();
  }
  if (!parsed.confirmed) {
    return { confirmed: false, height: null, time: null };
  }
  return { confirmed: true, height: sats(parsed.block_height), time: optionalInteger(parsed.block_time) };
}

export function parseTipHeight(body: unknown): number {
  return sats(body);
}

export function parseAddressStats(body: unknown): AddressStats {
  const parsed = record(body);
  const chain = record(parsed.chain_stats);
  const mempool = record(parsed.mempool_stats);
  const confirmed = sats(chain.funded_txo_sum) - sats(chain.spent_txo_sum);
  if (confirmed < 0) {
    malformed();
  }
  return {
    confirmed,
    unconfirmed: sats(mempool.funded_txo_sum) - sats(mempool.spent_txo_sum),
    chainTxCount: sats(chain.tx_count),
    mempoolTxCount: sats(mempool.tx_count),
  };
}

export function parseUtxos(body: unknown): EsploraUtxo[] {
  if (!Array.isArray(body)) {
    malformed();
  }
  return body.map((entry) => {
    const parsed = record(entry);
    const state = status(parsed.status);
    const value = sats(parsed.value);
    if (value === 0) {
      malformed();
    }
    return { txid: txid(parsed.txid), vout: sats(parsed.vout), value, confirmed: state.confirmed, height: state.height };
  });
}

function txEnd(value: unknown): EsploraTxEnd {
  const parsed = record(value);
  const address = typeof parsed.scriptpubkey_address === 'string' ? parsed.scriptpubkey_address : null;
  return { address, value: sats(parsed.value) };
}

export function parseTransactions(body: unknown): EsploraTx[] {
  if (!Array.isArray(body)) {
    malformed();
  }
  return body.map((entry) => {
    const parsed = record(entry);
    if (!Array.isArray(parsed.vin) || !Array.isArray(parsed.vout)) {
      malformed();
    }
    const state = status(parsed.status);
    const inputs = parsed.vin
      .map((input) => record(input))
      .filter((input) => input.is_coinbase !== true && input.prevout !== null && input.prevout !== undefined)
      .map((input) => txEnd(input.prevout));
    return {
      txid: txid(parsed.txid),
      confirmed: state.confirmed,
      height: state.height,
      time: state.time,
      fee: sats(parsed.fee ?? 0),
      inputs,
      outputs: parsed.vout.map(txEnd),
    };
  });
}

export type AddressView = {
  address: string;
  confirmed: number;
  unconfirmed: number;
  total: number;
  txCount: number;
  /** True when the address has any confirmed or unconfirmed transaction; drives gap-limit discovery on the device. */
  used: boolean;
};

export type UtxoView = {
  txid: string;
  vout: number;
  value: number;
  address: string;
  confirmed: boolean;
  height: number | null;
  confirmations: number;
};

export type HistoryDirection = 'incoming' | 'outgoing' | 'self';

export type HistoryView = {
  txid: string;
  confirmed: boolean;
  height: number | null;
  time: number | null;
  confirmations: number;
  /** Sats received by the wallet's addresses minus sats spent from them; includes the fee when the wallet paid it. */
  netAmount: number;
  /** The transaction's whole fee in sats. */
  fee: number;
  direction: HistoryDirection;
};

export type AccountView = {
  blockchain: string;
  tipHeight: number;
  balance: { confirmed: number; unconfirmed: number; total: number };
  addresses: AddressView[];
  utxos: UtxoView[];
  history: HistoryView[];
  historyLimit: number;
  /** False when an address has more transactions than one Esplora page or the merged list was cut at the limit. */
  historyComplete: boolean;
};

export type AddressData = {
  address: string;
  stats: AddressStats;
  utxos: EsploraUtxo[];
  transactions: EsploraTx[];
};

function confirmations(tipHeight: number, height: number | null): number {
  return height === null ? 0 : Math.max(0, tipHeight - height + 1);
}

function historyEntry(tx: EsploraTx, wallet: ReadonlySet<string>, tipHeight: number): HistoryView {
  const owned = (end: EsploraTxEnd) => end.address !== null && wallet.has(end.address);
  const spent = tx.inputs.filter(owned).reduce((sum, end) => sum + end.value, 0);
  const received = tx.outputs.filter(owned).reduce((sum, end) => sum + end.value, 0);
  const self = tx.inputs.length > 0 && tx.inputs.every(owned) && tx.outputs.every(owned);
  const direction: HistoryDirection = spent === 0 ? 'incoming' : self ? 'self' : 'outgoing';
  return {
    txid: tx.txid,
    confirmed: tx.confirmed,
    height: tx.height,
    time: tx.time,
    confirmations: confirmations(tipHeight, tx.height),
    netAmount: received - spent,
    fee: tx.fee,
    direction,
  };
}

function compareHistory(a: HistoryView, b: HistoryView): number {
  if (a.confirmed !== b.confirmed) {
    return a.confirmed ? 1 : -1;
  }
  if (a.height !== b.height) {
    return (b.height ?? 0) - (a.height ?? 0);
  }
  return a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0;
}

function compareUtxos(a: UtxoView, b: UtxoView): number {
  if (a.confirmed !== b.confirmed) {
    return a.confirmed ? 1 : -1;
  }
  if (a.height !== b.height) {
    return (b.height ?? 0) - (a.height ?? 0);
  }
  if (a.txid !== b.txid) {
    return a.txid < b.txid ? -1 : 1;
  }
  return a.vout - b.vout;
}

export function buildAccountView(
  blockchain: string,
  tipHeight: number,
  data: AddressData[],
  historyLimit: number,
): AccountView {
  const wallet = new Set(data.map((entry) => entry.address));
  const addresses: AddressView[] = data.map(({ address, stats }) => ({
    address,
    confirmed: stats.confirmed,
    unconfirmed: stats.unconfirmed,
    total: stats.confirmed + stats.unconfirmed,
    txCount: stats.chainTxCount + stats.mempoolTxCount,
    used: stats.chainTxCount + stats.mempoolTxCount > 0,
  }));
  const confirmed = addresses.reduce((sum, entry) => sum + entry.confirmed, 0);
  const unconfirmed = addresses.reduce((sum, entry) => sum + entry.unconfirmed, 0);

  const utxos = data
    .flatMap(({ address, utxos: list }) =>
      list.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        address,
        confirmed: utxo.confirmed,
        height: utxo.height,
        confirmations: confirmations(tipHeight, utxo.height),
      })),
    )
    .sort(compareUtxos);

  const transactions = new Map<string, EsploraTx>();
  let pagesComplete = true;
  for (const entry of data) {
    const confirmedSeen = entry.transactions.filter((tx) => tx.confirmed).length;
    const mempoolSeen = entry.transactions.length - confirmedSeen;
    if (confirmedSeen < entry.stats.chainTxCount || mempoolSeen < entry.stats.mempoolTxCount) {
      pagesComplete = false;
    }
    entry.transactions.forEach((tx) => transactions.set(tx.txid, tx));
  }
  const merged = [...transactions.values()].map((tx) => historyEntry(tx, wallet, tipHeight)).sort(compareHistory);

  return {
    blockchain,
    tipHeight,
    balance: { confirmed, unconfirmed, total: confirmed + unconfirmed },
    addresses,
    utxos,
    history: merged.slice(0, historyLimit),
    historyLimit,
    historyComplete: pagesComplete && merged.length <= historyLimit,
  };
}
