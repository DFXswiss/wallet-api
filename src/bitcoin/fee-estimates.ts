import { walletError } from '../common/wallet-error';

/** Integer fee rates in sat/vB. */
export type FeeRates = { fast: number; normal: number; slow: number };

export type FeeRateChoice = keyof FeeRates;

export const FEE_RATE_CHOICES: readonly FeeRateChoice[] = ['fast', 'normal', 'slow'];

/** Confirmation targets in blocks used to pick each rate from Esplora `fee-estimates`. */
export const FEE_TARGETS: Readonly<Record<FeeRateChoice, number>> = Object.freeze({ fast: 1, normal: 6, slow: 144 });

/** Upper bound for an explicit fee rate in a prepare request. */
export const MAX_FEE_RATE_SAT_PER_VB = 1000;

/**
 * Parses the Esplora `fee-estimates` body, `{ "<target blocks>": <sat/vB>, ... }`. Entries that are not a positive
 * integer target with a positive finite rate are a malformed upstream answer (502). `{}` gives an empty map.
 */
export function parseFeeEstimates(body: unknown): Map<number, number> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw walletError(502, 'OutboundRequestFailed');
  }
  const estimates = new Map<number, number>();
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const target = Number(key);
    if (!/^[1-9][0-9]{0,4}$/.test(key) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw walletError(502, 'OutboundRequestFailed');
    }
    estimates.set(target, value);
  }
  return estimates;
}

function pick(estimates: Map<number, number>, target: number): number {
  const targets = [...estimates.keys()].sort((a, b) => a - b);
  const key = targets.find((candidate) => candidate >= target) ?? targets[targets.length - 1];
  return roundUpRate(estimates.get(key) as number);
}

/** Fractions of a sat/vB up to this much are dropped before rounding up, so 1.004 becomes 1 and not 2. */
export const FEE_RATE_ROUNDING_TOLERANCE = 0.05;

/** Rounds up to a whole sat/vB after dropping {@link FEE_RATE_ROUNDING_TOLERANCE}, with a floor of 1 sat/vB. */
export function roundUpRate(rate: number): number {
  return Math.max(1, Math.ceil(Math.round((rate - FEE_RATE_ROUNDING_TOLERANCE) * 1000) / 1000));
}

/**
 * Picks fast, normal, and slow from the estimates: the estimate for the smallest target at or above the wanted
 * target, or the largest target present. The result is monotone (fast >= normal >= slow). Returns `undefined` for
 * an empty map.
 */
export function feeRatesFromEstimates(estimates: Map<number, number>): FeeRates | undefined {
  if (estimates.size === 0) {
    return undefined;
  }
  const fast = pick(estimates, FEE_TARGETS.fast);
  const normal = Math.min(fast, pick(estimates, FEE_TARGETS.normal));
  const slow = Math.min(normal, pick(estimates, FEE_TARGETS.slow));
  return { fast, normal, slow };
}
