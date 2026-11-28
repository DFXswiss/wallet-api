import * as btc from '@scure/btc-signer';
import { walletError } from '../common/wallet-error';
import { ESPLORA_REGTEST_BLOCKCHAIN } from '../proxy/esplora-regtest';
import type { FeeRates } from './fee-estimates';

/** Network parameters in the shape `@scure/btc-signer` expects. */
export type BitcoinNetworkParams = {
  bech32: string;
  pubKeyHash: number;
  scriptHash: number;
  wif: number;
};

export const MAINNET_PARAMS: BitcoinNetworkParams = { bech32: 'bc', pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 };
export const TESTNET_PARAMS: BitcoinNetworkParams = { bech32: 'tb', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
export const REGTEST_PARAMS: BitcoinNetworkParams = { bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };

export type BitcoinNetwork = {
  /** The Esplora blockchain id, as used in `ESPLORA_BASE_URLS` and in the route. */
  blockchain: string;
  params: BitcoinNetworkParams;
  /**
   * Fee rates used when Esplora answers `fee-estimates` with no estimate. Never used on `prd`; mainnet has none, so
   * an empty answer fails with 503 `FeeEstimatesUnavailable` instead of a guessed rate.
   */
  feeFallback?: FeeRates;
};

export const BITCOIN_NETWORKS: Readonly<Record<string, BitcoinNetwork>> = Object.freeze({
  Bitcoin: { blockchain: 'Bitcoin', params: MAINNET_PARAMS },
  BitcoinTestnet4: {
    blockchain: 'BitcoinTestnet4',
    params: TESTNET_PARAMS,
    feeFallback: { fast: 3, normal: 2, slow: 1 },
  },
  [ESPLORA_REGTEST_BLOCKCHAIN]: {
    blockchain: ESPLORA_REGTEST_BLOCKCHAIN,
    params: REGTEST_PARAMS,
    feeFallback: { fast: 3, normal: 2, slow: 1 },
  },
});

export function bitcoinNetwork(blockchain: string): BitcoinNetwork | undefined {
  return Object.hasOwn(BITCOIN_NETWORKS, blockchain) ? BITCOIN_NETWORKS[blockchain] : undefined;
}

export type BitcoinAddressType = 'pkh' | 'sh' | 'wpkh' | 'wsh' | 'tr';

const DESTINATION_TYPES: ReadonlySet<string> = new Set<BitcoinAddressType>(['pkh', 'sh', 'wpkh', 'wsh', 'tr']);

/**
 * Bitcoin Core's dust threshold at the default dust relay fee of 3 sat/vB, per output type. An output below this
 * value is not relayed.
 */
export const DUST_THRESHOLD: Readonly<Record<BitcoinAddressType, number>> = Object.freeze({
  pkh: 546,
  sh: 540,
  wpkh: 294,
  wsh: 330,
  tr: 330,
});

export type DecodedAddress = {
  /** Canonical form: bech32 and bech32m in lower case, base58 unchanged. */
  address: string;
  type: BitcoinAddressType;
  script: Uint8Array;
};

/** A bech32 address may be all upper case; it is stored and compared in lower case. Mixed case stays invalid. */
export function normalizeAddress(raw: string): string {
  return /^(BC|TB|BCRT)1[0-9A-Z]+$/.test(raw) ? raw.toLowerCase() : raw;
}

function decodeFor(params: BitcoinNetworkParams, raw: string): DecodedAddress | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const address = normalizeAddress(raw);
  try {
    const decoded = btc.Address(params).decode(address);
    if (!DESTINATION_TYPES.has(decoded.type)) {
      return undefined;
    }
    return { address, type: decoded.type as BitcoinAddressType, script: btc.OutScript.encode(decoded) };
  } catch {
    return undefined;
  }
}

/**
 * A wallet address is the device's BIP-84 address: P2WPKH (`bc1q`, `tb1q`, `bcrt1q`) on the route's network.
 * Throws 400 `AddressInvalid` otherwise.
 */
export function decodeWalletAddress(network: BitcoinNetwork, raw: string): DecodedAddress {
  const decoded = decodeFor(network.params, raw);
  if (!decoded || decoded.type !== 'wpkh' || !decoded.address.startsWith(`${network.params.bech32}1q`)) {
    throw walletError(400, 'AddressInvalid');
  }
  return decoded;
}

/**
 * A destination is any standard address on the route's network: P2PKH, P2SH, P2WPKH, P2WSH, or P2TR. An address that
 * is valid on another Bitcoin network answers 400 `DestinationWrongNetwork`; anything else 400 `DestinationInvalid`.
 */
export function decodeDestination(network: BitcoinNetwork, raw: string): DecodedAddress {
  const decoded = decodeFor(network.params, raw);
  if (decoded) {
    return decoded;
  }
  const others = [MAINNET_PARAMS, TESTNET_PARAMS, REGTEST_PARAMS].filter((params) => params !== network.params);
  if (others.some((params) => decodeFor(params, raw))) {
    throw walletError(400, 'DestinationWrongNetwork');
  }
  throw walletError(400, 'DestinationInvalid');
}
