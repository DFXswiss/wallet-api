import { feeRatesFromEstimates, parseFeeEstimates, roundUpRate } from '../src/bitcoin/fee-estimates';
import { walletCode } from './bitcoin-fixtures';

describe('fee estimates', () => {
  it('maps targets 1, 6, and 144 to fast, normal, and slow', () => {
    const estimates = parseFeeEstimates({ '1': 20.5, '2': 15, '3': 12, '6': 8.2, '144': 1.004, '1008': 1 });
    expect(feeRatesFromEstimates(estimates)).toEqual({ fast: 21, normal: 9, slow: 1 });
  });

  it('uses the next target above, or the largest target present', () => {
    expect(feeRatesFromEstimates(parseFeeEstimates({ '2': 10, '25': 5 }))).toEqual({ fast: 10, normal: 5, slow: 5 });
  });

  it('keeps fast >= normal >= slow', () => {
    expect(feeRatesFromEstimates(parseFeeEstimates({ '1': 5, '6': 10, '144': 20 }))).toEqual({
      fast: 5,
      normal: 5,
      slow: 5,
    });
  });

  it('returns nothing for an empty answer', () => {
    expect(feeRatesFromEstimates(parseFeeEstimates({}))).toBeUndefined();
  });

  it('rounds up to whole sat/vB with a floor of 1', () => {
    expect(roundUpRate(0.25)).toBe(1);
    expect(roundUpRate(1)).toBe(1);
    expect(roundUpRate(1.004)).toBe(1);
    expect(roundUpRate(1.05)).toBe(1);
    expect(roundUpRate(1.06)).toBe(2);
    expect(roundUpRate(8.2)).toBe(9);
    expect(roundUpRate(15)).toBe(15);
  });

  it.each([
    ['an array', [1, 2]],
    ['null', null],
    ['a string', '{}'],
    ['a non-numeric target', { fast: 1 }],
    ['a zero target', { '0': 1 }],
    ['a string rate', { '1': '5' }],
    ['a negative rate', { '1': -1 }],
    ['a zero rate', { '1': 0 }],
  ])('treats %s as a malformed upstream answer', (_label, body) => {
    expect(walletCode(() => parseFeeEstimates(body))).toEqual({ status: 502, code: 'OutboundRequestFailed' });
  });
});
