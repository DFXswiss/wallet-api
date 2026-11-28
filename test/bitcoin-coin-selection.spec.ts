import {
  CHANGE_DUST_THRESHOLD,
  CoinSelectionRequest,
  MAX_INPUTS,
  P2WPKH_INPUT_VBYTES,
  SelectableUtxo,
  estimateVsize,
  selectCoins,
  varIntSize,
} from '../src/bitcoin/coin-selection';
import { txid, walletCode } from './bitcoin-fixtures';

function utxo(value: number, byte = 'a', vout = 0): SelectableUtxo {
  return { txid: txid(byte), vout, value, address: 'bcrt1qwallet', confirmed: true };
}

function request(overrides: Partial<CoinSelectionRequest>): CoinSelectionRequest {
  return {
    utxos: [utxo(100_000)],
    amount: 50_000,
    feeRate: 1,
    destinationScriptLength: 22,
    destinationDust: 294,
    ...overrides,
  };
}

function selectionCode(overrides: Partial<CoinSelectionRequest>) {
  return walletCode(() => selectCoins(request(overrides)));
}

describe('vsize estimate', () => {
  it('matches the P2WPKH sizes', () => {
    expect(P2WPKH_INPUT_VBYTES).toBe(68);
    expect(estimateVsize(1, [22])).toBe(110);
    expect(estimateVsize(1, [22, 22])).toBe(141);
    expect(estimateVsize(2, [22, 22])).toBe(209);
    expect(estimateVsize(2, [22])).toBe(178);
    expect(estimateVsize(1, [34, 22])).toBe(153);
    expect(estimateVsize(1, [25, 22])).toBe(144);
  });

  it('counts var ints', () => {
    expect(varIntSize(0)).toBe(1);
    expect(varIntSize(252)).toBe(1);
    expect(varIntSize(253)).toBe(3);
    expect(varIntSize(0xffff)).toBe(3);
    expect(varIntSize(0x10000)).toBe(5);
  });
});

describe('coin selection', () => {
  it('creates change when it is at least dust', () => {
    const selection = selectCoins(request({ feeRate: 2 }));
    expect(selection).toMatchObject({
      amount: 50_000,
      fee: 282,
      change: 49_718,
      vsize: 141,
      totalInput: 100_000,
      changeAddedToFee: 0,
    });
    expect(selection.amount + selection.fee + selection.change).toBe(selection.totalInput);
  });

  it('selects the largest UTXO first and stops when it covers amount and fee', () => {
    const selection = selectCoins(request({ utxos: [utxo(10_000, 'a'), utxo(60_000, 'b'), utxo(30_000, 'c')] }));
    expect(selection.inputs.map((input) => input.value)).toEqual([60_000]);
    expect(selection).toMatchObject({ fee: 141, change: 9_859 });
  });

  it('adds inputs until the amount is covered', () => {
    const selection = selectCoins(request({ utxos: [utxo(30_000, 'b'), utxo(40_000, 'a')] }));
    expect(selection.inputs.map((input) => input.value)).toEqual([40_000, 30_000]);
    expect(selection).toMatchObject({ fee: 209, change: 19_791, vsize: 209 });
  });

  it('orders equal values by txid and vout', () => {
    const selection = selectCoins(
      request({ amount: 1_000, utxos: [utxo(5_000, 'c'), utxo(5_000, 'b', 1), utxo(5_000, 'b', 0)] }),
    );
    expect(selection.inputs).toEqual([utxo(5_000, 'b', 0)]);
  });

  it('adds change below dust to the fee instead of creating it', () => {
    const selection = selectCoins(request({ utxos: [utxo(50_400)] }));
    expect(selection).toMatchObject({ amount: 50_000, fee: 400, change: 0, vsize: 110, changeAddedToFee: 290 });
    expect(selection.amount + selection.fee).toBe(selection.totalInput);
  });

  it('creates change of exactly the dust threshold', () => {
    const selection = selectCoins(request({ utxos: [utxo(50_000 + 141 + CHANGE_DUST_THRESHOLD)] }));
    expect(selection).toMatchObject({ change: 294, fee: 141, changeAddedToFee: 0 });
  });

  it('pays a fee of exactly amount plus fee without change', () => {
    const selection = selectCoins(request({ utxos: [utxo(50_110)] }));
    expect(selection).toMatchObject({ fee: 110, change: 0, changeAddedToFee: 0 });
  });

  it('refuses insufficient funds', () => {
    expect(selectionCode({ utxos: [utxo(50_109)] })).toEqual({ status: 422, code: 'InsufficientFunds' });
    expect(selectionCode({ utxos: [] })).toEqual({ status: 422, code: 'InsufficientFunds' });
  });

  it('refuses an amount below the destination dust threshold', () => {
    expect(selectionCode({ amount: 293 })).toEqual({ status: 422, code: 'AmountBelowDust' });
    expect(selectionCode({ amount: 545, destinationScriptLength: 25, destinationDust: 546 })).toEqual({
      status: 422,
      code: 'AmountBelowDust',
    });
    expect(selectCoins(request({ amount: 546, destinationScriptLength: 25, destinationDust: 546 })).amount).toBe(546);
    expect(selectCoins(request({ amount: 294 })).amount).toBe(294);
  });

  it('refuses a fee higher than the amount', () => {
    expect(selectionCode({ amount: 300, feeRate: 5 })).toEqual({ status: 422, code: 'FeeExceedsAmount' });
  });

  it('leaves out UTXOs that cost at least their value to spend', () => {
    const selection = selectCoins(
      request({ amount: 10_000, feeRate: 10, utxos: [utxo(680, 'a'), utxo(100_000, 'b')] }),
    );
    expect(selection.uneconomicalUtxos).toBe(1);
    expect(selection.inputs.map((input) => input.value)).toEqual([100_000]);
    expect(selection).toMatchObject({ fee: 1_410, change: 88_590 });
    expect(selectionCode({ amount: 10_000, feeRate: 10, utxos: [utxo(680)] })).toEqual({
      status: 422,
      code: 'InsufficientFunds',
    });
  });

  it('refuses more than the input cap', () => {
    const utxos = Array.from({ length: MAX_INPUTS + 1 }, (_, index) => utxo(1_000, 'a', index));
    expect(selectionCode({ utxos, amount: 199_000 })).toEqual({ status: 422, code: 'TooManyInputs' });
    expect(selectionCode({ utxos: utxos.slice(0, MAX_INPUTS), amount: 199_000 })).toEqual({
      status: 422,
      code: 'InsufficientFunds',
    });
  });

  it('counts a zero-value UTXO as uneconomical and never spends it', () => {
    const selection = selectCoins(request({ utxos: [utxo(0, 'b'), utxo(100_000)] }));
    expect(selection.inputs).toEqual([utxo(100_000)]);
    expect(selection.uneconomicalUtxos).toBe(1);
    const max = selectCoins(request({ utxos: [utxo(0, 'b'), utxo(100_000)], amount: 'max' }));
    expect(max.inputs).toEqual([utxo(100_000)]);
    expect(max.uneconomicalUtxos).toBe(1);
    expect(selectionCode({ utxos: [utxo(0, 'b')] })).toEqual({ status: 422, code: 'InsufficientFunds' });
  });

  it('refuses a non-integer fee rate or amount', () => {
    expect(() => selectCoins(request({ feeRate: 1.5 }))).toThrow();
    expect(() => selectCoins(request({ amount: 1_000.5 }))).toThrow();
    expect(() => selectCoins(request({ utxos: [utxo(1_000.5)] }))).toThrow();
  });
});

describe('max send', () => {
  it('spends every spendable UTXO into one output without change', () => {
    const selection = selectCoins(
      request({ amount: 'max', feeRate: 2, utxos: [utxo(30_000, 'a'), utxo(20_000, 'b')] }),
    );
    expect(selection).toMatchObject({ amount: 49_644, fee: 356, change: 0, vsize: 178, totalInput: 50_000 });
    expect(selection.inputs).toHaveLength(2);
  });

  it('refuses when nothing is spendable', () => {
    expect(selectionCode({ amount: 'max', utxos: [] })).toEqual({ status: 422, code: 'InsufficientFunds' });
    expect(selectionCode({ amount: 'max', feeRate: 10, utxos: [utxo(500)] })).toEqual({
      status: 422,
      code: 'InsufficientFunds',
    });
  });

  it('refuses when the remainder is below dust', () => {
    expect(selectionCode({ amount: 'max', utxos: [utxo(400)] })).toEqual({ status: 422, code: 'AmountBelowDust' });
  });

  it('refuses when the fee is higher than the remainder', () => {
    expect(selectionCode({ amount: 'max', feeRate: 4, utxos: [utxo(800)] })).toEqual({
      status: 422,
      code: 'FeeExceedsAmount',
    });
  });

  it('refuses more than the input cap', () => {
    const utxos = Array.from({ length: MAX_INPUTS + 1 }, (_, index) => utxo(10_000, 'a', index));
    expect(selectionCode({ amount: 'max', utxos })).toEqual({ status: 422, code: 'TooManyInputs' });
  });
});
