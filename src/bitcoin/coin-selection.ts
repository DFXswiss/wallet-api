import { walletError } from '../common/wallet-error';
import { DUST_THRESHOLD } from './bitcoin-network';

/** 21 million BTC in sats. */
export const MAX_MONEY_SATS = 2_100_000_000_000_000;

/** Inputs per prepared transaction. Selection that needs more answers 422 `TooManyInputs`. */
export const MAX_INPUTS = 200;

/** P2WPKH output script: OP_0 <20-byte hash>. */
export const P2WPKH_SCRIPT_LENGTH = 22;

/** Change is P2WPKH; change below this value is not created and is added to the fee instead. */
export const CHANGE_DUST_THRESHOLD = DUST_THRESHOLD.wpkh;

/**
 * Upper bound of a signed P2WPKH input in vbytes: 41 bytes outside the witness (outpoint 36, empty script 1,
 * sequence 4) = 164 weight units, plus a witness of 108 weight units (item count 1, a 72-byte signature with its
 * length byte, a 33-byte public key with its length byte). 272 / 4 = 68.
 */
export const P2WPKH_INPUT_VBYTES = 68;

const P2WPKH_INPUT_BASE_BYTES = 41;
const P2WPKH_INPUT_WITNESS_WEIGHT = 108;
const SEGWIT_MARKER_FLAG_WEIGHT = 2;

export type SelectableUtxo = {
  txid: string;
  vout: number;
  value: number;
  address: string;
  confirmed: boolean;
};

export type CoinSelectionRequest = {
  utxos: SelectableUtxo[];
  /** Integer sats, or `max` to send everything spendable minus the fee. */
  amount: number | 'max';
  /** Integer sat/vB, at least 1. */
  feeRate: number;
  destinationScriptLength: number;
  destinationDust: number;
};

export type CoinSelection = {
  inputs: SelectableUtxo[];
  totalInput: number;
  amount: number;
  fee: number;
  /** 0 when no change output is created. */
  change: number;
  vsize: number;
  /** Change below the dust threshold that went to the fee instead of a change output. 0 otherwise. */
  changeAddedToFee: number;
  /** UTXOs left out because spending them costs at least their value at this fee rate. */
  uneconomicalUtxos: number;
};

export function varIntSize(value: number): number {
  if (value < 0xfd) {
    return 1;
  }
  if (value <= 0xffff) {
    return 3;
  }
  return value <= 0xffffffff ? 5 : 9;
}

/**
 * Virtual size in vbytes of a version 2 transaction with `inputCount` signed P2WPKH inputs and outputs with the given
 * script lengths. The signature is counted at its maximum length, so the estimate never undershoots.
 */
export function estimateVsize(inputCount: number, outputScriptLengths: number[]): number {
  const outputs = outputScriptLengths.reduce((sum, length) => sum + 8 + varIntSize(length) + length, 0);
  const base =
    4 +
    varIntSize(inputCount) +
    inputCount * P2WPKH_INPUT_BASE_BYTES +
    varIntSize(outputScriptLengths.length) +
    outputs +
    4;
  const witness = SEGWIT_MARKER_FLAG_WEIGHT + inputCount * P2WPKH_INPUT_WITNESS_WEIGHT;
  return Math.ceil((base * 4 + witness) / 4);
}

function compareUtxos(a: SelectableUtxo, b: SelectableUtxo): number {
  if (a.value !== b.value) {
    return b.value - a.value;
  }
  if (a.txid !== b.txid) {
    return a.txid < b.txid ? -1 : 1;
  }
  return a.vout - b.vout;
}

function assertInteger(value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error('Coin selection received a non-integer amount');
  }
}

/**
 * Deterministic largest-first selection over P2WPKH UTXOs. All amounts are integer sats.
 *
 * - UTXOs whose value does not exceed the cost of spending them (68 vB x fee rate) are left out.
 * - A change output is created only when it is at least the P2WPKH dust threshold (294 sats); a smaller remainder
 *   is added to the fee and reported as `changeAddedToFee`.
 * - Errors (all 422): `AmountBelowDust` when the amount is below the destination's dust threshold,
 *   `InsufficientFunds`, `TooManyInputs` above {@link MAX_INPUTS}, and `FeeExceedsAmount` when the fee is higher
 *   than the amount that reaches the destination.
 */
export function selectCoins(request: CoinSelectionRequest): CoinSelection {
  const { feeRate, destinationScriptLength, destinationDust } = request;
  assertInteger(feeRate, 1);
  // Zero-value outputs are valid on chain and anyone can send one to a wallet address; they are counted as
  // uneconomical below and never spent.
  request.utxos.forEach((utxo) => assertInteger(utxo.value, 0));
  const ordered = [...request.utxos].sort(compareUtxos);
  const spendable = ordered.filter((utxo) => utxo.value > P2WPKH_INPUT_VBYTES * feeRate);
  const uneconomicalUtxos = ordered.length - spendable.length;
  const destinationOnly = [destinationScriptLength];
  const withChange = [destinationScriptLength, P2WPKH_SCRIPT_LENGTH];

  if (request.amount === 'max') {
    if (spendable.length === 0) {
      throw walletError(422, 'InsufficientFunds');
    }
    if (spendable.length > MAX_INPUTS) {
      throw walletError(422, 'TooManyInputs');
    }
    const totalInput = spendable.reduce((sum, utxo) => sum + utxo.value, 0);
    const vsize = estimateVsize(spendable.length, destinationOnly);
    const fee = vsize * feeRate;
    const amount = totalInput - fee;
    if (amount <= 0) {
      throw walletError(422, 'InsufficientFunds');
    }
    if (amount < destinationDust) {
      throw walletError(422, 'AmountBelowDust');
    }
    if (fee > amount) {
      throw walletError(422, 'FeeExceedsAmount');
    }
    return {
      inputs: spendable,
      totalInput,
      amount,
      fee,
      change: 0,
      vsize,
      changeAddedToFee: 0,
      uneconomicalUtxos,
    };
  }

  const amount = request.amount;
  assertInteger(amount, 1);
  if (amount < destinationDust) {
    throw walletError(422, 'AmountBelowDust');
  }
  const inputs: SelectableUtxo[] = [];
  let totalInput = 0;
  for (const utxo of spendable) {
    if (inputs.length === MAX_INPUTS) {
      throw walletError(422, 'TooManyInputs');
    }
    inputs.push(utxo);
    totalInput += utxo.value;
    const vsizeWithoutChange = estimateVsize(inputs.length, destinationOnly);
    const feeWithoutChange = vsizeWithoutChange * feeRate;
    if (totalInput < amount + feeWithoutChange) {
      continue;
    }
    const vsizeWithChange = estimateVsize(inputs.length, withChange);
    const feeWithChange = vsizeWithChange * feeRate;
    const change = totalInput - amount - feeWithChange;
    const selection: CoinSelection =
      change >= CHANGE_DUST_THRESHOLD
        ? {
            inputs,
            totalInput,
            amount,
            fee: feeWithChange,
            change,
            vsize: vsizeWithChange,
            changeAddedToFee: 0,
            uneconomicalUtxos,
          }
        : {
            inputs,
            totalInput,
            amount,
            fee: totalInput - amount,
            change: 0,
            vsize: vsizeWithoutChange,
            changeAddedToFee: totalInput - amount - feeWithoutChange,
            uneconomicalUtxos,
          };
    if (selection.fee > amount) {
      throw walletError(422, 'FeeExceedsAmount');
    }
    return selection;
  }
  throw walletError(422, 'InsufficientFunds');
}
