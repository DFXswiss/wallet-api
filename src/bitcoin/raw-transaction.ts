import * as btc from '@scure/btc-signer';
import { walletError } from '../common/wallet-error';
import { txidFromSerialization } from './psbt-builder';

/** Upper bound for a submitted transaction: standard transactions are at most 400,000 weight units. */
export const MAX_RAW_TRANSACTION_BYTES = 400_000;

export type ParsedInput = {
  txid: string;
  vout: number;
  sequence: number;
  scriptSigLength: number;
  witness: Buffer[];
};

export type ParsedOutput = {
  value: bigint;
  script: Buffer;
};

export type ParsedTransaction = {
  version: number;
  locktime: number;
  segwit: boolean;
  inputs: ParsedInput[];
  outputs: ParsedOutput[];
  /** Double SHA-256 of the serialization without witness data, in display order. */
  txid: string;
};

class Reader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  peek(index: number): number | undefined {
    return this.buffer[this.offset + index];
  }

  skip(length: number): void {
    this.take(length);
  }

  take(length: number): Buffer {
    if (length < 0 || length > this.remaining) {
      throw new Error('truncated');
    }
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  u32(): number {
    return this.take(4).readUInt32LE(0);
  }

  u64(): bigint {
    return this.take(8).readBigUInt64LE(0);
  }

  varInt(): number {
    const first = this.take(1)[0];
    if (first < 0xfd) {
      return first;
    }
    if (first === 0xfd) {
      return this.take(2).readUInt16LE(0);
    }
    if (first === 0xfe) {
      return this.take(4).readUInt32LE(0);
    }
    const value = this.u64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('varint too large');
    }
    return Number(value);
  }

  /** A count of items each at least `minimumItemSize` bytes long, bounded by what is left. */
  count(minimumItemSize: number): number {
    const value = this.varInt();
    if (value * minimumItemSize > this.remaining) {
      throw new Error('count exceeds data');
    }
    return value;
  }
}

/**
 * Parses a serialized Bitcoin transaction (legacy or BIP-144 segwit). Throws 400 `TransactionInvalid` when the bytes
 * are not exactly one transaction.
 */
export function parseRawTransaction(raw: Buffer): ParsedTransaction {
  if (raw.length === 0 || raw.length > MAX_RAW_TRANSACTION_BYTES) {
    throw walletError(400, 'TransactionInvalid');
  }
  try {
    const reader = new Reader(raw);
    const version = reader.u32();
    let segwit = false;
    if (reader.peek(0) === 0x00) {
      if (reader.peek(1) !== 0x01) {
        throw new Error('no inputs');
      }
      segwit = true;
      reader.skip(2);
    }
    const bodyStart = reader.position;
    const inputCount = reader.count(41);
    if (inputCount === 0) {
      throw new Error('no inputs');
    }
    const inputs: ParsedInput[] = [];
    for (let index = 0; index < inputCount; index++) {
      const txid = Buffer.from(reader.take(32)).reverse().toString('hex');
      const vout = reader.u32();
      const scriptSigLength = reader.count(1);
      reader.skip(scriptSigLength);
      const sequence = reader.u32();
      inputs.push({ txid, vout, sequence, scriptSigLength, witness: [] });
    }
    const outputCount = reader.count(9);
    if (outputCount === 0) {
      throw new Error('no outputs');
    }
    const outputs: ParsedOutput[] = [];
    for (let index = 0; index < outputCount; index++) {
      const value = reader.u64();
      const script = Buffer.from(reader.take(reader.count(1)));
      outputs.push({ value, script });
    }
    const bodyEnd = reader.position;
    if (segwit) {
      for (const input of inputs) {
        const items = reader.count(1);
        for (let item = 0; item < items; item++) {
          input.witness.push(Buffer.from(reader.take(reader.count(1))));
        }
      }
      if (inputs.every((input) => input.witness.length === 0)) {
        throw new Error('segwit marker without witness');
      }
    }
    const locktime = reader.u32();
    if (reader.remaining !== 0) {
      throw new Error('trailing bytes');
    }
    // version | inputs and outputs | locktime, without the segwit marker, flag, and witnesses.
    const withoutWitness = Buffer.concat([
      raw.subarray(0, 4),
      raw.subarray(bodyStart, bodyEnd),
      raw.subarray(raw.length - 4),
    ]);
    return { version, locktime, segwit, inputs, outputs, txid: txidFromSerialization(withoutWitness) };
  } catch (error) {
    if (error && typeof error === 'object' && 'getStatus' in error) {
      throw error;
    }
    throw walletError(400, 'TransactionInvalid');
  }
}

export function parseTransactionHex(hex: string): Buffer {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw walletError(400, 'TransactionInvalid');
  }
  if (hex.length > MAX_RAW_TRANSACTION_BYTES * 2) {
    throw walletError(400, 'TransactionInvalid');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Extracts the network transaction from a signed PSBT (base64). A PSBT whose inputs are signed but not yet finalized
 * is finalized here; finalizing needs no key. Throws 400 `TransactionNotSigned` when an input has no signature and
 * 400 `TransactionInvalid` when the PSBT cannot be decoded.
 */
export function extractFromPsbt(psbtBase64: string): Buffer {
  if (
    typeof psbtBase64 !== 'string' ||
    psbtBase64.length > MAX_RAW_TRANSACTION_BYTES * 3 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(psbtBase64)
  ) {
    throw walletError(400, 'TransactionInvalid');
  }
  let tx: btc.Transaction;
  try {
    tx = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(psbtBase64, 'base64')));
  } catch {
    throw walletError(400, 'TransactionInvalid');
  }
  try {
    if (!tx.isFinal) {
      tx.finalize();
    }
    return Buffer.from(tx.extract());
  } catch {
    throw walletError(400, 'TransactionNotSigned');
  }
}

/** Largest DER-encoded ECDSA signature (72 bytes) plus the sighash type byte. */
export const MAX_SIGNATURE_LENGTH = 73;

/** Key of a previous output, `<txid>:<vout>`, as used by {@link isSignedP2wpkh}. */
export function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

function p2wpkhScript(publicKey: Buffer): Buffer | undefined {
  if (publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
    return undefined;
  }
  try {
    return Buffer.from(btc.p2wpkh(new Uint8Array(publicKey)).script);
  } catch {
    return undefined;
  }
}

/**
 * True when every input is a complete P2WPKH spend of the prepared previous output: an empty script signature and a
 * two-item witness of a non-empty signature of at most {@link MAX_SIGNATURE_LENGTH} bytes and a compressed public
 * key whose P2WPKH script is the script of the spent output in `prevoutScripts` (keyed by {@link outpointKey}). An
 * input whose outpoint is not in `prevoutScripts` fails. Whether the signature is valid is decided by the node on
 * broadcast.
 */
export function isSignedP2wpkh(tx: ParsedTransaction, prevoutScripts: ReadonlyMap<string, Uint8Array>): boolean {
  if (!tx.segwit || tx.inputs.length === 0 || tx.inputs.length !== prevoutScripts.size) {
    return false;
  }
  return tx.inputs.every((input) => {
    const expected = prevoutScripts.get(outpointKey(input.txid, input.vout));
    if (!expected || input.scriptSigLength !== 0 || input.witness.length !== 2) {
      return false;
    }
    const [signature, publicKey] = input.witness;
    if (signature.length < 1 || signature.length > MAX_SIGNATURE_LENGTH) {
      return false;
    }
    const script = p2wpkhScript(publicKey);
    return script !== undefined && script.equals(Buffer.from(expected));
  });
}
