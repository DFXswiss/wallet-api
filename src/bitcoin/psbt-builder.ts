import * as btc from '@scure/btc-signer';
import { createHash } from 'node:crypto';

export const TX_VERSION = 2;
export const TX_LOCKTIME = 0;
/** BIP-125 opt-in replace-by-fee. */
export const RBF_SEQUENCE = 0xfffffffd;
/** No replace-by-fee signal, no relative lock time. */
export const FINAL_SEQUENCE = 0xffffffff;

export type PsbtInput = {
  txid: string;
  vout: number;
  /** Integer sats. */
  value: number;
  /** The P2WPKH output script being spent. */
  script: Uint8Array;
};

export type PsbtOutput = {
  /** Integer sats. */
  value: number;
  script: Uint8Array;
};

export type UnsignedPayment = {
  /** BIP-174 PSBT (version 0), base64. */
  psbt: string;
  /** The txid of the transaction; for P2WPKH inputs it does not change when the device signs. */
  txid: string;
};

/**
 * Builds the unsigned PSBT. Every input carries its `witnessUtxo` (script and amount), which is what a BIP-143 signer
 * needs. No BIP-32 derivation is included: the device knows its paths and finds the key by the input's address.
 */
export function buildUnsignedPayment(inputs: PsbtInput[], outputs: PsbtOutput[], sequence: number): UnsignedPayment {
  const tx = new btc.Transaction({ version: TX_VERSION, lockTime: TX_LOCKTIME });
  for (const input of inputs) {
    tx.addInput({
      // Display order, as btc-signer expects; it reverses the bytes when it serializes the outpoint.
      txid: new Uint8Array(Buffer.from(input.txid, 'hex')),
      index: input.vout,
      sequence,
      witnessUtxo: { script: input.script, amount: BigInt(input.value) },
    });
  }
  for (const output of outputs) {
    tx.addOutput({ script: output.script, amount: BigInt(output.value) });
  }
  return {
    psbt: Buffer.from(tx.toPSBT()).toString('base64'),
    txid: unsignedTxid(inputs, outputs, sequence),
  };
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function encodeVarInt(value: number): Buffer {
  if (value < 0xfd) {
    return Buffer.from([value]);
  }
  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0xfd;
    buffer.writeUInt16LE(value, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = 0xfe;
  buffer.writeUInt32LE(value, 1);
  return buffer;
}

/** Serialization without witness data, the preimage of the txid. */
export function serializeWithoutWitness(inputs: PsbtInput[], outputs: PsbtOutput[], sequence: number): Buffer {
  const parts: Buffer[] = [u32(TX_VERSION), encodeVarInt(inputs.length)];
  for (const input of inputs) {
    parts.push(Buffer.from(input.txid, 'hex').reverse(), u32(input.vout), Buffer.from([0]), u32(sequence));
  }
  parts.push(encodeVarInt(outputs.length));
  for (const output of outputs) {
    parts.push(u64(output.value), encodeVarInt(output.script.length), Buffer.from(output.script));
  }
  parts.push(u32(TX_LOCKTIME));
  return Buffer.concat(parts);
}

export function txidFromSerialization(serialized: Buffer): string {
  const once = createHash('sha256').update(serialized).digest();
  return Buffer.from(createHash('sha256').update(once).digest()).reverse().toString('hex');
}

export function unsignedTxid(inputs: PsbtInput[], outputs: PsbtOutput[], sequence: number): string {
  return txidFromSerialization(serializeWithoutWitness(inputs, outputs, sequence));
}
