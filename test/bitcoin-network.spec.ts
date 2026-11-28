import {
  BITCOIN_NETWORKS,
  DUST_THRESHOLD,
  MAINNET_PARAMS,
  REGTEST_PARAMS,
  TESTNET_PARAMS,
  bitcoinNetwork,
  decodeDestination,
  decodeWalletAddress,
  normalizeAddress,
} from '../src/bitcoin/bitcoin-network';
import { p2pkh, p2shP2wpkh, p2tr, p2wpkh, walletCode } from './bitcoin-fixtures';

const mainnet = BITCOIN_NETWORKS.Bitcoin;
const testnet4 = BITCOIN_NETWORKS.BitcoinTestnet4;
const regtest = BITCOIN_NETWORKS.BitcoinRegtest;

describe('bitcoin networks', () => {
  it('knows mainnet, testnet4, and regtest with their bech32 prefixes', () => {
    expect(bitcoinNetwork('Bitcoin')?.params.bech32).toBe('bc');
    expect(bitcoinNetwork('BitcoinTestnet4')?.params.bech32).toBe('tb');
    expect(bitcoinNetwork('BitcoinRegtest')?.params.bech32).toBe('bcrt');
    expect(bitcoinNetwork('Litecoin')).toBeUndefined();
    expect(bitcoinNetwork('toString')).toBeUndefined();
    expect(bitcoinNetwork('__proto__')).toBeUndefined();
  });

  it('has no fee fallback for mainnet', () => {
    expect(mainnet.feeFallback).toBeUndefined();
    expect(testnet4.feeFallback).toEqual({ fast: 3, normal: 2, slow: 1 });
    expect(regtest.feeFallback).toEqual({ fast: 3, normal: 2, slow: 1 });
  });

  it('uses Bitcoin Core dust thresholds', () => {
    expect(DUST_THRESHOLD).toEqual({ pkh: 546, sh: 540, wpkh: 294, wsh: 330, tr: 330 });
  });
});

describe('wallet addresses', () => {
  it.each([
    ['Bitcoin', MAINNET_PARAMS, 'bc1q'],
    ['BitcoinTestnet4', TESTNET_PARAMS, 'tb1q'],
    ['BitcoinRegtest', REGTEST_PARAMS, 'bcrt1q'],
  ])('accepts a P2WPKH address on %s', (blockchain, params, prefix) => {
    const address = p2wpkh(1, params);
    expect(address.startsWith(prefix)).toBe(true);
    const decoded = decodeWalletAddress(BITCOIN_NETWORKS[blockchain], address);
    expect(decoded).toMatchObject({ address, type: 'wpkh' });
    expect(decoded.script.length).toBe(22);
  });

  it('accepts an all upper case bech32 address and returns it in lower case', () => {
    const address = p2wpkh(1, REGTEST_PARAMS);
    expect(decodeWalletAddress(regtest, address.toUpperCase()).address).toBe(address);
    expect(normalizeAddress(address.toUpperCase())).toBe(address);
  });

  it('refuses a mixed case bech32 address', () => {
    const address = p2wpkh(1, REGTEST_PARAMS);
    const mixed = address.slice(0, 10).toUpperCase() + address.slice(10);
    expect(walletCode(() => decodeWalletAddress(regtest, mixed))).toEqual({ status: 400, code: 'AddressInvalid' });
  });

  it.each([
    ['a mainnet address on regtest', regtest, p2wpkh(1, MAINNET_PARAMS)],
    ['a testnet address on regtest', regtest, p2wpkh(1, TESTNET_PARAMS)],
    ['a regtest address on testnet4', testnet4, p2wpkh(1, REGTEST_PARAMS)],
    ['a regtest address on mainnet', mainnet, p2wpkh(1, REGTEST_PARAMS)],
    ['a P2PKH address', regtest, p2pkh(1, REGTEST_PARAMS)],
    ['a P2SH address', regtest, p2shP2wpkh(1, REGTEST_PARAMS)],
    ['a P2TR address', regtest, p2tr(1, REGTEST_PARAMS)],
    ['garbage', regtest, 'bcrt1qnotanaddress'],
    ['an empty string', regtest, ''],
  ])('refuses %s', (_label, network, address) => {
    expect(walletCode(() => decodeWalletAddress(network, address))).toEqual({ status: 400, code: 'AddressInvalid' });
  });
});

describe('destinations', () => {
  it.each([
    ['P2WPKH', p2wpkh(3, REGTEST_PARAMS), 'wpkh', 22],
    ['P2PKH', p2pkh(3, REGTEST_PARAMS), 'pkh', 25],
    ['P2SH', p2shP2wpkh(3, REGTEST_PARAMS), 'sh', 23],
    ['P2TR', p2tr(3, REGTEST_PARAMS), 'tr', 34],
  ])('accepts a %s destination', (_label, address, type, scriptLength) => {
    const decoded = decodeDestination(regtest, address);
    expect(decoded.type).toBe(type);
    expect(decoded.script.length).toBe(scriptLength);
  });

  it('names the wrong network', () => {
    expect(walletCode(() => decodeDestination(regtest, p2wpkh(3, MAINNET_PARAMS)))).toEqual({
      status: 400,
      code: 'DestinationWrongNetwork',
    });
    expect(walletCode(() => decodeDestination(mainnet, p2tr(3, TESTNET_PARAMS)))).toEqual({
      status: 400,
      code: 'DestinationWrongNetwork',
    });
    expect(walletCode(() => decodeDestination(mainnet, p2wpkh(3, REGTEST_PARAMS)))).toEqual({
      status: 400,
      code: 'DestinationWrongNetwork',
    });
  });

  it('refuses an invalid destination', () => {
    for (const address of ['', 'hello', 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', `${p2wpkh(3, REGTEST_PARAMS)}x`]) {
      expect(walletCode(() => decodeDestination(regtest, address))).toEqual({
        status: 400,
        code: 'DestinationInvalid',
      });
    }
  });
});
