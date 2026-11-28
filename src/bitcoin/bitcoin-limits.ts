/** Addresses per account or prepare request (receive and change together). */
export const MAX_WALLET_ADDRESSES = 50;

/** Shortest and longest Bitcoin address string accepted before decoding. */
export const MIN_ADDRESS_LENGTH = 14;
export const MAX_ADDRESS_LENGTH = 90;

/** A prepared payment can be submitted for this long. */
export const PREPARE_TTL_MS = 10 * 60 * 1000;

/**
 * Prepared payments are deleted once they expired this long ago; a repeat submit within that window is answered.
 * The delete runs in every prepare, before every submit lookup, and every {@link PREPARE_SWEEP_INTERVAL_MS} in each
 * running instance (BitcoinPaymentStore).
 */
export const PREPARE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Interval of the background sweep of prepared payments past {@link PREPARE_RETENTION_MS}. */
export const PREPARE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Unexpired, unsubmitted prepared payments per wallet account. The next prepare answers 429. */
export const MAX_LIVE_PREPARES = 20;

/** Parallel Esplora requests per wallet request. */
export const ESPLORA_CONCURRENCY = 4;
