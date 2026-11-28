import { HttpException } from '@nestjs/common';
import * as btc from '@scure/btc-signer';
import { createECDH } from 'node:crypto';
import { BitcoinNetworkParams } from '../src/bitcoin/bitcoin-network';

/** Test-only keys. A key is 32 bytes of the same value; never use such keys with real funds. */
export function privateKey(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

export function publicKey(seed: number): Uint8Array {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKey(seed)));
  return new Uint8Array(ecdh.getPublicKey(null, 'compressed'));
}

export function p2wpkh(seed: number, params: BitcoinNetworkParams): string {
  return btc.p2wpkh(publicKey(seed), params).address as string;
}

export function p2pkh(seed: number, params: BitcoinNetworkParams): string {
  return btc.p2pkh(publicKey(seed), params).address as string;
}

export function p2shP2wpkh(seed: number, params: BitcoinNetworkParams): string {
  return btc.p2sh(btc.p2wpkh(publicKey(seed), params), params).address as string;
}

export function p2tr(seed: number, params: BitcoinNetworkParams): string {
  return btc.p2tr(publicKey(seed).subarray(1), undefined, params).address as string;
}

export function txid(byte: string): string {
  return byte.repeat(64);
}

export function walletCode(run: () => unknown): { status: number; code: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), code: (error.getResponse() as { code: string }).code };
    }
    throw error;
  }
  throw new Error('Expected a wallet error');
}

export async function walletCodeAsync(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), code: (error.getResponse() as { code: string }).code };
    }
    throw error;
  }
  throw new Error('Expected a wallet error');
}
